import type { Db } from '@wi/db';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerBinRoutes } from './routes/bins.js';
import { registerCaptureRoutes } from './routes/capture.js';
import { registerReadRoutes } from './routes/read.js';

/**
 * Builds the Fastify instance with every route registered.
 *
 * The returned server is not listening. Call `listen` on it, or pass it to
 * `inject` in a test to exercise routes without opening a port.
 */
export function buildApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));
  registerBinRoutes(app, db);
  registerCaptureRoutes(app, db);
  registerReadRoutes(app, db);

  return app;
}
