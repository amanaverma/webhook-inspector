import { bins, createDb } from '@wi/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

type Page = { requests: { id: string }[]; nextCursor: string | null };

const db = createDb(process.env.DATABASE_URL!);
const app = buildApp(db);

let slug: string;
let emptySlug: string;

beforeAll(async () => {
  await app.ready();

  slug = (await app.inject({ method: 'POST', url: '/api/bins', payload: { name: 'Read' } })).json().slug;
  emptySlug = (await app.inject({ method: 'POST', url: '/api/bins', payload: { name: 'Empty' } })).json().slug;

  for (let i = 0; i < 12; i++) {
    await app.inject({
      method: 'POST',
      url: `/i/${slug}/event/${i}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ i }),
    });
  }
});

afterAll(async () => {
  await db.delete(bins).where(eq(bins.slug, slug));
  await db.delete(bins).where(eq(bins.slug, emptySlug));
  await app.close();
});

describe('GET /api/bins', () => {
  it('lists bins newest first', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/bins' });
    const slugs = response.json().bins.map((bin: { slug: string }) => bin.slug);

    expect(response.statusCode).toBe(200);
    expect(slugs.indexOf(emptySlug)).toBeLessThan(slugs.indexOf(slug));
  });
});

describe('GET /api/bins/:slug', () => {
  it('returns the bin with its request count', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/bins/${slug}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ slug, name: 'Read', requestCount: 12 });
  });

  it('returns 404 for an unknown slug', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/bins/nosuchbin' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });
});

describe('GET /api/bins/:slug/requests', () => {
  it('returns the newest requests first', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/bins/${slug}/requests?limit=5` });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.requests).toHaveLength(5);
    expect(body.requests[0].path).toBe(`/i/${slug}/event/11`);
    expect(body.nextCursor).toBeTruthy();
  });

  it('pages through every request exactly once', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;

    do {
      const url: string = `/api/bins/${slug}/requests?limit=5${cursor ? `&cursor=${cursor}` : ''}`;
      const body = (await app.inject({ method: 'GET', url })).json() as Page;
      seen.push(...body.requests.map((row) => row.id));
      cursor = body.nextCursor;
    } while (cursor);

    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it('is stable when a request arrives mid-page', async () => {
    const first = (await app.inject({ method: 'GET', url: `/api/bins/${slug}/requests?limit=5` })).json();

    await app.inject({ method: 'POST', url: `/i/${slug}/late`, payload: 'late' });

    const second = (await app.inject({
      method: 'GET',
      url: `/api/bins/${slug}/requests?limit=5&cursor=${first.nextCursor}`,
    })).json();

    const overlap = second.requests.filter((row: { id: string }) =>
      first.requests.some((earlier: { id: string }) => earlier.id === row.id),
    );
    expect(overlap).toHaveLength(0);
  });

  it('returns an empty page and no cursor for a bin with no requests', async () => {
    const body = (await app.inject({ method: 'GET', url: `/api/bins/${emptySlug}/requests` })).json();
    expect(body).toEqual({ requests: [], nextCursor: null });
  });

  it('rejects a limit outside the allowed range', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/bins/${slug}/requests?limit=500` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_query');
  });

  it('rejects a cursor it did not issue', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/bins/${slug}/requests?cursor=garbage` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_cursor');
  });
});

describe('GET /api/requests/:id', () => {
  it('returns the full record with a text body', async () => {
    const payload = '{"amount":1200}';
    await app.inject({
      method: 'POST',
      url: `/i/${slug}/detail`,
      headers: { 'content-type': 'application/json', 'x-signature': 'sig' },
      payload,
    });

    const list = (await app.inject({ method: 'GET', url: `/api/bins/${slug}/requests?limit=1` })).json();
    const response = await app.inject({ method: 'GET', url: `/api/requests/${list.requests[0].id}` });
    const row = response.json();

    expect(response.statusCode).toBe(200);
    expect(row.body).toBe(payload);
    expect(row.bodyEncoding).toBe('utf8');
    expect(row.headers['x-signature']).toBe('sig');
    expect(row.path).toBe(`/i/${slug}/detail`);
  });

  it('base64 encodes a binary body and round trips it', async () => {
    const payload = Buffer.from([0x00, 0xff, 0x1f, 0x80]);
    await app.inject({
      method: 'POST',
      url: `/i/${slug}/binary`,
      headers: { 'content-type': 'application/octet-stream' },
      payload,
    });

    const list = (await app.inject({ method: 'GET', url: `/api/bins/${slug}/requests?limit=1` })).json();
    const row = (await app.inject({ method: 'GET', url: `/api/requests/${list.requests[0].id}` })).json();

    expect(row.bodyEncoding).toBe('base64');
    expect(Buffer.from(row.body, 'base64').equals(payload)).toBe(true);
  });

  it('returns 404 for an id that does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/requests/3f3d4c8a-6a0e-4a4a-9a1f-0f2c1d9b7e55',
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns 400 for an id that is not a uuid', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/requests/not-a-uuid' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_id');
  });
});
