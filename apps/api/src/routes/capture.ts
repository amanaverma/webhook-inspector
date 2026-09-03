import { bins, requests, type Db } from '@wi/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify';

const METHODS: HTTPMethods[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** Header values Fastify may hand over as an array are joined with a comma, as on the wire. */
function flattenHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

/**
 * Registers the capture endpoint on `/i/:slug` and every path below it.
 *
 * Stores the request as it arrived, including the unparsed body, and answers
 * 200 once the row is written. An unknown or inactive slug gets a 404 and
 * nothing is stored.
 *
 * Routes are registered inside their own plugin scope so that replacing the
 * body parser with one that keeps raw bytes does not affect the JSON parsing
 * the rest of the API relies on.
 */
export function registerCaptureRoutes(app: FastifyInstance, db: Db): void {
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    const handler = async (request: FastifyRequest, reply: FastifyReply) => {
      const { slug } = request.params as { slug: string };

      const [bin] = await db
        .select({ id: bins.id })
        .from(bins)
        .where(and(eq(bins.slug, slug), eq(bins.isActive, true)))
        .limit(1);

      if (!bin) {
        return reply.code(404).send({ error: 'unknown_bin' });
      }

      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const [row] = await db
        .insert(requests)
        .values({
          binId: bin.id,
          method: request.method,
          path: request.url.split('?')[0]!,
          query: request.query as Record<string, string | string[]>,
          headers: flattenHeaders(request),
          body,
          bodySize: body.byteLength,
          contentType: request.headers['content-type'] ?? null,
          sourceIp: request.ip,
        })
        .returning({ id: requests.id, receivedAt: requests.receivedAt });

      return reply.code(200).send({ id: row!.id, receivedAt: row!.receivedAt });
    };

    scope.route({ method: METHODS, url: '/i/:slug', handler });
    scope.route({ method: METHODS, url: '/i/:slug/*', handler });
  });
}
