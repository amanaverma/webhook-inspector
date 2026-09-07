import { bins, createDb, requests } from '@wi/db';
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { MAX_BODY_BYTES } from './capture.js';

const db = createDb(process.env.DATABASE_URL!);
const app = buildApp(db);

let slug: string;
let binId: string;
let inactiveSlug: string;

beforeAll(async () => {
  await app.ready();

  const created = (await app.inject({ method: 'POST', url: '/api/bins', payload: { name: 'Capture' } })).json();
  slug = created.slug;
  binId = created.id;

  inactiveSlug = (await app.inject({ method: 'POST', url: '/api/bins', payload: { name: 'Off' } })).json().slug;
  await db.update(bins).set({ isActive: false }).where(eq(bins.slug, inactiveSlug));
});

afterAll(async () => {
  await db.delete(bins).where(eq(bins.slug, slug));
  await db.delete(bins).where(eq(bins.slug, inactiveSlug));
  await app.close();
});

async function latest() {
  const [row] = await db
    .select()
    .from(requests)
    .where(eq(requests.binId, binId))
    .orderBy(desc(requests.receivedAt), desc(requests.id))
    .limit(1);
  return row!;
}

describe('capture endpoint', () => {
  it('accepts every method', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      const response = await app.inject({ method, url: `/i/${slug}` });
      expect(response.statusCode, method).toBe(200);
    }
  });

  it('returns 404 for an unknown slug', async () => {
    const response = await app.inject({ method: 'POST', url: '/i/doesnotexist' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'unknown_bin' });
  });

  it('returns 404 for an inactive bin and stores nothing', async () => {
    const before = await db.select().from(requests).where(eq(requests.binId, binId));
    const response = await app.inject({ method: 'POST', url: `/i/${inactiveSlug}` });
    const after = await db.select().from(requests).where(eq(requests.binId, binId));

    expect(response.statusCode).toBe(404);
    expect(after).toHaveLength(before.length);
  });

  it('stores a JSON body byte for byte', async () => {
    const payload = '{"amount":  1200,\n  "currency":"usd"}';
    await app.inject({
      method: 'POST',
      url: `/i/${slug}/webhooks/stripe?attempt=2`,
      headers: { 'content-type': 'application/json', 'x-signature': 'abc123' },
      payload,
    });

    const row = await latest();
    expect(row.body.toString('utf8')).toBe(payload);
    expect(row.bodySize).toBe(Buffer.byteLength(payload));
    expect(row.method).toBe('POST');
    expect(row.path).toBe(`/i/${slug}/webhooks/stripe`);
    expect(row.query).toEqual({ attempt: '2' });
    expect(row.headers['x-signature']).toBe('abc123');
    expect(row.contentType).toBe('application/json');
  });

  it('stores a form body without parsing it', async () => {
    const payload = 'a=1&b=two+words';
    await app.inject({
      method: 'POST',
      url: `/i/${slug}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload,
    });

    expect((await latest()).body.toString('utf8')).toBe(payload);
  });

  it('stores binary bodies unchanged', async () => {
    const payload = Buffer.from([0x00, 0xff, 0x1f, 0x80, 0x00, 0x7f]);
    await app.inject({
      method: 'POST',
      url: `/i/${slug}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload,
    });

    const row = await latest();
    expect(row.body.equals(payload)).toBe(true);
    expect(row.bodySize).toBe(6);
  });

  it('stores an empty body as zero bytes', async () => {
    await app.inject({ method: 'GET', url: `/i/${slug}` });

    const row = await latest();
    expect(row.bodySize).toBe(0);
    expect(row.body).toHaveLength(0);
  });

  it('keeps JSON parsing intact for the rest of the API', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/bins', payload: { name: 'Still JSON' } });
    expect(response.statusCode).toBe(201);
    await db.delete(bins).where(eq(bins.id, response.json().id));
  });
});

describe('body size limit', () => {
  it('stores a body one byte under the limit in full', async () => {
    const payload = Buffer.alloc(MAX_BODY_BYTES - 1, 'a');
    const response = await app.inject({
      method: 'POST',
      url: `/i/${slug}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload,
    });

    const row = await latest();
    expect(response.statusCode).toBe(200);
    expect(row.truncated).toBe(false);
    expect(row.bodySize).toBe(MAX_BODY_BYTES - 1);
    expect(row.body).toHaveLength(MAX_BODY_BYTES - 1);
  });

  it('stores a body exactly at the limit in full', async () => {
    const payload = Buffer.alloc(MAX_BODY_BYTES, 'b');
    const response = await app.inject({
      method: 'POST',
      url: `/i/${slug}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload,
    });

    const row = await latest();
    expect(response.statusCode).toBe(200);
    expect(row.truncated).toBe(false);
    expect(row.bodySize).toBe(MAX_BODY_BYTES);
  });

  it('answers 413 and keeps a truncated record when over the limit', async () => {
    const payload = Buffer.alloc(MAX_BODY_BYTES + 4096, 'c');
    const response = await app.inject({
      method: 'POST',
      url: `/i/${slug}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload,
    });

    const row = await latest();
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ error: 'body_too_large', limit: MAX_BODY_BYTES });
    expect(row.truncated).toBe(true);
    expect(row.bodySize).toBe(MAX_BODY_BYTES + 4096);
    expect(row.body).toHaveLength(MAX_BODY_BYTES);
    expect(row.body.every((byte) => byte === 'c'.charCodeAt(0))).toBe(true);
  });

  it('keeps both values of a repeated header', async () => {
    await app.inject({
      method: 'POST',
      url: `/i/${slug}`,
      headers: { 'x-forwarded-for': ['10.0.0.1', '10.0.0.2'] },
      payload: 'x',
    });

    const forwarded = (await latest()).headers['x-forwarded-for'];
    expect(forwarded).toContain('10.0.0.1');
    expect(forwarded).toContain('10.0.0.2');
  });
});
