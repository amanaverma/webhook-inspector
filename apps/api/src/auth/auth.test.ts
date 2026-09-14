import { bins, createDb, users } from '@wi/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { COOKIE_NAME } from './session.js';

const db = createDb(process.env.DATABASE_URL!);
const app = buildApp(db);

const alice = { email: 'alice@example.com', password: 'correct horse battery' };
const bob = { email: 'bob@example.com', password: 'another long secret' };

let aliceCookie = '';
let bobCookie = '';
let aliceSlug = '';
let orphanSlug = '';

function cookieFrom(response: { cookies: { name: string; value: string }[] }) {
  const cookie = response.cookies.find((entry) => entry.name === COOKIE_NAME);
  return cookie ? `${cookie.name}=${cookie.value}` : '';
}

beforeAll(async () => {
  await app.ready();
  for (const email of [alice.email, bob.email]) await db.delete(users).where(eq(users.email, email));

  aliceCookie = cookieFrom(await app.inject({ method: 'POST', url: '/api/auth/signup', payload: alice }));
  bobCookie = cookieFrom(await app.inject({ method: 'POST', url: '/api/auth/signup', payload: bob }));

  aliceSlug = (await app.inject({
    method: 'POST',
    url: '/api/bins',
    headers: { cookie: aliceCookie },
    payload: { name: 'Alice bin' },
  })).json().slug;

  orphanSlug = (await app.inject({ method: 'POST', url: '/api/bins', payload: { name: 'Orphan' } })).json().slug;
});

afterAll(async () => {
  await db.delete(bins).where(eq(bins.slug, orphanSlug));
  for (const email of [alice.email, bob.email]) await db.delete(users).where(eq(users.email, email));
  await app.close();
});

describe('signup and login', () => {
  it('rejects a short password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'x@example.com', password: 'short' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a duplicate email', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: alice });
    expect(response.statusCode).toBe(409);
  });

  it('sets an httpOnly session cookie on login', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: alice });
    const cookie = response.cookies.find((entry) => entry.name === COOKIE_NAME);

    expect(response.statusCode).toBe(200);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
  });

  it('answers the same for a wrong password and an unknown email', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { ...alice, password: 'wrong but long enough' },
    });
    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: 'wrong but long enough' },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
  });

  it('stops the session working after logout', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: bob });
    const cookie = cookieFrom(login);

    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('bin ownership', () => {
  it('hides another user bin from the list', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/bins', headers: { cookie: bobCookie } });
    const slugs = response.json().bins.map((bin: { slug: string }) => bin.slug);
    expect(slugs).not.toContain(aliceSlug);
  });

  it('answers reads of another user bin as if it did not exist', async () => {
    for (const url of [`/api/bins/${aliceSlug}`, `/api/bins/${aliceSlug}/requests`]) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie: bobCookie } });
      expect(response.statusCode, url).toBe(404);
      expect(response.json(), url).toEqual({ error: 'not_found' });
    }
  });

  it('answers writes to another user bin as if it did not exist', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/bins/${aliceSlug}`,
      headers: { cookie: bobCookie },
      payload: { name: 'stolen' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('answers an anonymous caller as if the bin did not exist', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/bins/${aliceSlug}` });
    expect(response.statusCode).toBe(404);
  });

  it('gives the same answer for another user bin and a missing one', async () => {
    const theirs = await app.inject({ method: 'GET', url: `/api/bins/${aliceSlug}`, headers: { cookie: bobCookie } });
    const missing = await app.inject({ method: 'GET', url: '/api/bins/zzzzzzzzzz', headers: { cookie: bobCookie } });
    expect([theirs.statusCode, theirs.body]).toEqual([missing.statusCode, missing.body]);
  });

  it('lets the owner through', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/bins/${aliceSlug}`,
      headers: { cookie: aliceCookie },
    });
    expect(response.statusCode).toBe(200);
  });

  it('keeps a bin with no owner reachable', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/bins/${orphanSlug}` });
    expect(response.statusCode).toBe(200);
  });

  it('still captures on another user bin, since providers have no session', async () => {
    const response = await app.inject({ method: 'POST', url: `/i/${aliceSlug}/hook`, payload: 'x' });
    expect(response.statusCode).toBe(200);
  });
});
