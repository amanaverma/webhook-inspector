import type { Db } from '@wi/db';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth } from './auth/plugin.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerBinRoutes } from './routes/bins.js';
import { registerCaptureRoutes } from './routes/capture.js';
import { registerReadRoutes } from './routes/read.js';
import { registerStreamRoutes } from './routes/stream.js';
import { collectMetrics } from './retention.js';

/**
 * Builds the Fastify instance with every route registered.
 *
 * The returned server is not listening. Call `listen` on it, or pass it to
 * `inject` in a test to exercise routes without opening a port.
 */
export function buildApp(
  db: Db,
  databaseUrl = process.env.DATABASE_URL ?? '',
  redis: Redis | null = null,
): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    // Trusts the id a proxy already assigned, so one request keeps one id across services.
    genReqId: (request) => (request.headers['x-request-id'] as string) ?? randomUUID(),
  });

  // Echoes the id so a caller can quote it when reporting a problem.
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  registerAuth(app, db);

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.get('/metrics', async () => collectMetrics(db));
  registerAuthRoutes(app, db, redis);
  registerBinRoutes(app, db);
  registerCaptureRoutes(app, db, redis);
  registerReadRoutes(app, db);
  registerStreamRoutes(app, db, databaseUrl);

  return app;
}
