import { bins, createDb } from '@wi/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

const db = createDb(process.env.DATABASE_URL!);
const app = buildApp(db);

let slug: string;
let inactiveSlug: string;

beforeAll(async () => {
  await app.ready();
  slug = (await app.inject({ method: 'POST', url: '/api/bins', payload: { name: 'Capture' } })).json().slug;
  inactiveSlug = (await app.inject({ method: 'POST', url: '/api/bins', payload: { name: 'Off' } })).json().slug;
  await db.update(bins).set({ isActive: false }).where(eq(bins.slug, inactiveSlug));
});

afterAll(async () => {
  await db.delete(bins).where(eq(bins.slug, slug));
  await db.delete(bins).where(eq(bins.slug, inactiveSlug));
  await app.close();
});

describe('capture endpoint', () => {
  it('accepts every method', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      const response = await app.inject({ method, url: `/i/${slug}` });
      expect(response.statusCode, method).toBe(200);
    }
  });

  it('accepts any path below the slug', async () => {
    const response = await app.inject({ method: 'POST', url: `/i/${slug}/events/v2?x=1` });
    expect(response.statusCode).toBe(200);
  });

  it('returns 404 for an unknown slug', async () => {
    const response = await app.inject({ method: 'POST', url: '/i/doesnotexist' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'unknown_bin' });
  });

  it('returns 404 for an inactive bin', async () => {
    const response = await app.inject({ method: 'POST', url: `/i/${inactiveSlug}` });
    expect(response.statusCode).toBe(404);
  });
});
