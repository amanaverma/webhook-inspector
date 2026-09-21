import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/**
 * Creates an account and returns its session cookie.
 *
 * Each call uses a fresh email, so suites running together never share a user.
 * Pass the cookie as the `cookie` header on requests that need an owner.
 */
export async function signedInCookie(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email: `test-${randomUUID()}@example.com`, password: 'a-long-enough-password' },
  });

  const cookie = response.cookies.find((entry) => entry.name === 'wi_session');
  if (!cookie) throw new Error(`signup did not set a session cookie: ${response.statusCode} ${response.body}`);

  return `wi_session=${cookie.value}`;
}
