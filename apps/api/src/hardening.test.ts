import { bins, createDb, requests } from '@wi/db';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { CAPACITY, spendToken } from './rate-limit.js';
import { collectMetrics, pruneRequests } from './retention.js';

const db = createDb(process.env.DATABASE_URL!);
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', { maxRetriesPerRequest: 2 });
const app = buildApp(db, process.env.DATABASE_URL!, redis);

let slug: string;

beforeAll(async () => {
  await app.ready();
  slug = (await app.inject({ method: 'POST', url: '/api/bins', payload: { name: 'Hardening' } })).json().slug;
  await redis.del(`rl:bin:${slug}`);
});

afterAll(async () => {
  await redis.del(`rl:bin:${slug}`);
  await db.delete(bins).where(eq(bins.slug, slug));
  redis.disconnect();
  await app.close();
});

describe('rate limiting', () => {
  it('spends tokens and refuses once the bucket is empty', async () => {
    const key = `rl:test:${Date.now()}`;
    let last = { allowed: true, remaining: CAPACITY };

    for (let i = 0; i < CAPACITY; i++) last = await spendToken(redis, key);
    expect(last.allowed).toBe(true);

    const overflow = await spendToken(redis, key);
    expect(overflow.allowed).toBe(false);

    await redis.del(key);
  });

  it('answers 429 on capture once the bin bucket is empty', async () => {
    await redis.hset(`rl:bin:${slug}`, 'tokens', 0, 'updated', Date.now() / 1000);

    const response = await app.inject({ method: 'POST', url: `/i/${slug}/flood`, payload: 'x' });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: 'rate_limited' });

    await redis.del(`rl:bin:${slug}`);
  });

  it('captures normally with tokens available', async () => {
    const response = await app.inject({ method: 'POST', url: `/i/${slug}/fine`, payload: 'x' });
    expect(response.statusCode).toBe(200);
    expect(Number(response.headers['x-ratelimit-remaining'])).toBeGreaterThan(0);
  });
});

describe('retention', () => {
  it('removes requests past the window and keeps newer ones', async () => {
    const [bin] = await db.select({ id: bins.id }).from(bins).where(eq(bins.slug, slug)).limit(1);

    await db.execute(sql`
      insert into requests (bin_id, method, path, body, body_size, received_at)
      values (${bin!.id}, 'POST', '/old', decode('7b7d', 'hex'), 2, now() - interval '30 days')
    `);

    const before = await db.select().from(requests).where(eq(requests.binId, bin!.id));
    const removed = await pruneRequests(db, 7);
    const after = await db.select().from(requests).where(eq(requests.binId, bin!.id));

    expect(removed).toBe(1);
    expect(after).toHaveLength(before.length - 1);
    expect(after.some((row) => row.path === '/old')).toBe(false);
  });
});

describe('operational endpoints', () => {
  it('reports readiness when the database answers', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
  });

  it('exposes counters as numbers', async () => {
    const metrics = await collectMetrics(db);
    for (const key of ['requests_total', 'deliveries_queued', 'bins_total']) {
      expect(typeof metrics[key], key).toBe('number');
    }

    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
  });

  it('carries a request id through to the response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'trace-me-123' },
    });
    expect(response.headers['x-request-id']).toBe('trace-me-123');
  });
});
