import { bins, createDb, requests, users } from '@wi/db';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { CAPACITY, LOGIN_CAPACITY, spendToken } from './rate-limit.js';
import { collectMetrics, pruneRequests } from './retention.js';
import { signedInCookie } from './test-auth.js';

const db = createDb(process.env.DATABASE_URL!);
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', { maxRetriesPerRequest: 2 });
const app = buildApp(db, process.env.DATABASE_URL!, redis);

let cookie: string;

let slug: string;

beforeAll(async () => {
  cookie = await signedInCookie(app);
  await app.ready();
  slug = (await app.inject({ headers: { cookie }, method: 'POST', url: '/api/bins', payload: { name: 'Hardening' } })).json().slug;
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

describe('metrics access', () => {
  const original = process.env.METRICS_TOKEN;
  afterAll(() => {
    if (original === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = original;
  });

  it('is open when no token is configured', async () => {
    delete process.env.METRICS_TOKEN;
    expect((await app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(200);
  });

  it('requires the token once one is configured', async () => {
    process.env.METRICS_TOKEN = 'secret-token';

    expect((await app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer wrong' } })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer secret-token' } })).statusCode,
    ).toBe(200);
  });
});

describe('capture rate limiting by client', () => {
  it('stops a flood aimed at slugs that do not exist', async () => {
    const ip = '203.0.113.7';
    await redis.del(`rl:ip:${ip}`);

    const codes: number[] = [];
    for (let i = 0; i < CAPACITY + 5; i++) {
      const response = await app.inject({
        method: 'POST',
        url: `/i/nosuchbin${i}`,
        remoteAddress: ip,
        payload: 'x',
      });
      codes.push(response.statusCode);
    }

    expect(codes).toContain(429);
    expect(codes.at(-1)).toBe(429);
    await redis.del(`rl:ip:${ip}`);
  });
});

describe('login rate limiting', () => {
  it('stops guessing after the bucket empties', async () => {
    const email = `brute-${Date.now()}@example.com`;
    await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'a-long-enough-password' } });

    const codes: number[] = [];
    for (let i = 0; i < LOGIN_CAPACITY + 3; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: `wrong-guess-${i}` },
      });
      codes.push(response.statusCode);
    }

    expect(codes).toContain(429);
    expect(codes.at(-1)).toBe(429);

    await db.delete(users).where(eq(users.email, email));
    await redis.del(`rl:login:127.0.0.1:${email}`, 'rl:login:ip:127.0.0.1');
  });

  it('does not let one client lock an account for everyone else', async () => {
    const email = `lockout-${Date.now()}@example.com`;
    const password = 'a-long-enough-password';
    const attacker = '198.51.100.9';
    const owner = '198.51.100.10';

    await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password } });
    await redis.del(`rl:login:${attacker}:${email}`, `rl:login:${owner}:${email}`, `rl:login:ip:${attacker}`, `rl:login:ip:${owner}`);

    for (let i = 0; i < LOGIN_CAPACITY + 2; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: attacker,
        payload: { email, password: `attacker-guess-${i}` },
      });
    }

    const attackerNow = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: attacker,
      payload: { email, password },
    });
    const ownerNow = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: owner,
      payload: { email, password },
    });

    expect(attackerNow.statusCode).toBe(429);
    expect(ownerNow.statusCode).toBe(200);

    await db.delete(users).where(eq(users.email, email));
  });
});
