import type { Db } from '@wi/db';
import { users } from '@wi/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import {
  LOGIN_CAPACITY,
  LOGIN_IP_CAPACITY,
  LOGIN_IP_REFILL_PER_SECOND,
  LOGIN_REFILL_PER_SECOND,
  SIGNUP_CAPACITY,
  SIGNUP_REFILL_PER_SECOND,
  spendToken,
} from '../rate-limit.js';
import {
  checkPassword,
  COOKIE_NAME,
  createSession,
  destroySession,
  hashPassword,
  verifyAgainstDummy,
} from './session.js';

const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(10).max(200),
});

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

/**
 * Registers signup, login and logout.
 *
 * Login answers the same 401 whether the email is unknown or the password is
 * wrong, so the response cannot be used to learn which addresses have accounts.
 */
export function registerAuthRoutes(app: FastifyInstance, db: Db, redis: Redis | null = null): void {
  app.post('/api/auth/signup', async (request, reply) => {
    const parsed = credentials.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: z.treeifyError(parsed.error) });
    }

    // Spent before the hash, since hashing is the cost an unlimited signup
    // endpoint hands to anyone who asks.
    if (redis) {
      const limit = await spendToken(redis, `rl:signup:${request.ip}`, SIGNUP_CAPACITY, SIGNUP_REFILL_PER_SECOND);
      if (!limit.allowed) return reply.code(429).send({ error: 'too_many_attempts' });
    }

    const email = parsed.data.email.toLowerCase();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return reply.code(409).send({ error: 'email_taken' });

    const passwordHash = await hashPassword(parsed.data.password);
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id, email: users.email });

    // Two signups for one address can both pass the check above, and the second
    // insert then writes nothing.
    if (!user) return reply.code(409).send({ error: 'email_taken' });

    const { token, expiresAt } = await createSession(db, user.id);
    setSessionCookie(reply, token, expiresAt);
    return reply.code(201).send(user);
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = credentials.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(401).send({ error: 'invalid_credentials' });

    if (redis) {
      const email = parsed.data.email.toLowerCase();
      // Keyed by address and client together, so guessing against one account is
      // limited without letting an attacker lock its owner out by burning a
      // bucket keyed on the address alone. The wider per client bucket bounds
      // someone working through many addresses.
      const buckets = await Promise.all([
        spendToken(redis, `rl:login:${request.ip}:${email}`, LOGIN_CAPACITY, LOGIN_REFILL_PER_SECOND),
        spendToken(redis, `rl:login:ip:${request.ip}`, LOGIN_IP_CAPACITY, LOGIN_IP_REFILL_PER_SECOND),
      ]);
      if (buckets.some((bucket) => !bucket.allowed)) {
        return reply.code(429).send({ error: 'too_many_attempts' });
      }
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, parsed.data.email.toLowerCase()))
      .limit(1);

    // Hashing runs either way, so the reply takes the same time whether or not
    // the address has an account.
    const ok = user
      ? await checkPassword(parsed.data.password, user.passwordHash)
      : await verifyAgainstDummy(parsed.data.password);

    if (!user || !ok) return reply.code(401).send({ error: 'invalid_credentials' });

    const { token, expiresAt } = await createSession(db, user.id);
    setSessionCookie(reply, token, expiresAt);
    return { id: user.id, email: user.email };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[COOKIE_NAME];
    if (token) await destroySession(db, token);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'unauthenticated' });
    return { id: request.user.id, email: request.user.email };
  });
}
