import { bins, type Db } from '@wi/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, HTTPMethods, RouteHandlerMethod } from 'fastify';

const METHODS: HTTPMethods[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/**
 * Registers the capture endpoint on `/i/:slug` and every path below it.
 *
 * Responds 200 when the slug names an active bin and 404 when it does not, for
 * any method. Nothing is stored yet.
 */
export function registerCaptureRoutes(app: FastifyInstance, db: Db): void {
  const handler: RouteHandlerMethod = async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const [bin] = await db
      .select({ id: bins.id })
      .from(bins)
      .where(and(eq(bins.slug, slug), eq(bins.isActive, true)))
      .limit(1);

    if (!bin) {
      return reply.code(404).send({ error: 'unknown_bin' });
    }

    return reply.code(200).send({ received: true });
  };

  app.route({ method: METHODS, url: '/i/:slug', handler });
  app.route({ method: METHODS, url: '/i/:slug/*', handler });
}
