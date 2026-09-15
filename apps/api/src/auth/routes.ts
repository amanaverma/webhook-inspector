import type { Db } from '@wi/db';
import { users } from '@wi/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { checkPassword, COOKIE_NAME, createSession, destroySession, hashPassword } from './session.js';

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
export function registerAuthRoutes(app: FastifyInstance, db: Db): void {
  app.post('/api/auth/signup', async (request, reply) => {
    const parsed = credentials.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: z.treeifyError(parsed.error) });
    }

    const email = parsed.data.email.toLowerCase();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return reply.code(409).send({ error: 'email_taken' });

    const [user] = await db
      .insert(users)
      .values({ email, passwordHash: await hashPassword(parsed.data.password) })
      .returning({ id: users.id, email: users.email });

    const { token, expiresAt } = await createSession(db, user!.id);
    setSessionCookie(reply, token, expiresAt);
    return reply.code(201).send(user);
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = credentials.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(401).send({ error: 'invalid_credentials' });

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, parsed.data.email.toLowerCase()))
      .limit(1);

    const ok = user ? await checkPassword(parsed.data.password, user.passwordHash) : false;
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
