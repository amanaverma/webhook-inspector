import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Builds the Fastify instance with every route registered.
 *
 * The returned server is not listening. Call `listen` on it, or pass it to
 * `inject` in a test to exercise routes without opening a port.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
