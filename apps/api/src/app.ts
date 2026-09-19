import type { Db } from '@wi/db';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { registerAuth } from './auth/plugin.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerBinRoutes } from './routes/bins.js';
import { registerCaptureRoutes } from './routes/capture.js';
import { registerReadRoutes } from './routes/read.js';
import { registerStreamRoutes } from './routes/stream.js';
import { collectMetrics } from './retention.js';

/** Cuts the values a failed statement carried, which are whatever the caller sent. */
function withoutValues(message: string): string {
  const at = message.indexOf('\nparams:');
  return at === -1 ? message : message.slice(0, at);
}

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
  trustProxy: false | string = false,
): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    // Off unless a deployment says otherwise. Behind a proxy every client
    // otherwise shares one address, which collapses the rate limit buckets into
    // one and records the proxy as the source of every captured request.
    trustProxy,
    // A sender that opens a connection and then stops writing holds a slot until
    // this fires. Fastify leaves it off by default, which lets a handful of slow
    // senders hold every connection the process has.
    requestTimeout: 30_000,
    // Trusts the id a proxy already assigned, so one request keeps one id across services.
    genReqId: (request) => (request.headers['x-request-id'] as string) ?? randomUUID(),
  });

  // A 5xx answers with a request id only. Its message is logged, never sent,
  // because the database driver puts the failed statement and the values it
  // carried into that message. A 4xx keeps the shape the framework sends.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status < 500) {
      return reply
        .code(status)
        .send({ statusCode: status, code: error.code, error: STATUS_CODES[status], message: error.message });
    }

    request.log.error(
      { code: error.code, name: error.name, message: withoutValues(error.message), stack: error.stack },
      'request failed',
    );
    return reply.code(status).send({ error: 'internal_error', requestId: request.id });
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

  app.get('/metrics', async (request, reply) => {
    // Open when no token is set, which suits local use; a deployment sets one
    // and gives it to whatever scrapes this.
    const expected = process.env.METRICS_TOKEN;
    if (expected && request.headers.authorization !== `Bearer ${expected}`) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }

    return collectMetrics(db);
  });
  registerAuthRoutes(app, db, redis);
  registerBinRoutes(app, db);
  registerCaptureRoutes(app, db, redis);
  registerReadRoutes(app, db);
  registerStreamRoutes(app, db, databaseUrl);

  return app;
}
