import { createDb, bins } from '@wi/db';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

const db = createDb(process.env.DATABASE_URL!);
const app = buildApp(db);
const created: string[] = [];

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  for (const id of created) {
    await db.delete(bins).where(eq(bins.id, id));
  }
  await app.close();
});

async function post(body: Record<string, unknown>): Promise<LightMyRequestResponse> {
  const response = await app.inject({ method: 'POST', url: '/api/bins', payload: body });
  if (response.statusCode === 201) {
    created.push(response.json().id);
  }
  return response;
}

describe('POST /api/bins', () => {
  it('creates a bin and returns it', async () => {
    const response = await post({ name: 'Stripe test' });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: 'Stripe test',
      forwardUrl: null,
      isActive: true,
    });
    expect(response.json().slug).toMatch(/^[a-hj-km-np-z2-9]{10}$/);
  });

  it('defaults the name when the body is empty', async () => {
    const response = await post({});

    expect(response.statusCode).toBe(201);
    expect(response.json().name).toBe('Untitled bin');
  });

  it('stores a forward URL when one is given', async () => {
    const response = await post({ name: 'Relay', forwardUrl: 'https://example.com/hook' });

    expect(response.statusCode).toBe(201);
    expect(response.json().forwardUrl).toBe('https://example.com/hook');
  });

  it('rejects a forward URL that is not http', async () => {
    const response = await post({ forwardUrl: 'ftp://example.com' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_body');
  });

  it('rejects an empty name', async () => {
    const response = await post({ name: '   ' });

    expect(response.statusCode).toBe(400);
  });

  it('persists the row', async () => {
    const slug = (await post({ name: 'Persisted' })).json().slug;
    const rows = await db.select().from(bins).where(eq(bins.slug, slug));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Persisted');
  });
});
