import cookie from '@fastify/cookie';
import type { Db, User } from '@wi/db';
import type { FastifyInstance } from 'fastify';
import { COOKIE_NAME, userForToken } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed in user, or null for an anonymous request. */
    user: User | null;
  }
}

/**
 * Reads the session cookie on every request and attaches the user to it.
 *
 * Attaching rather than rejecting keeps the capture endpoint open, since a
 * provider posting a webhook has no session.
 */
export function registerAuth(app: FastifyInstance, db: Db): void {
  void app.register(cookie);

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[COOKIE_NAME];
    request.user = token ? await userForToken(db, token) : null;
  });
}
