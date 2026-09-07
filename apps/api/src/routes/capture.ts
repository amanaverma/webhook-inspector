import { bins, requests, type Db } from '@wi/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify';

const METHODS: HTTPMethods[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export const MAX_BODY_BYTES = 1_048_576;

type CapturedBody = {
  /** The first `MAX_BODY_BYTES` bytes of the body. */
  bytes: Buffer;
  /** Total bytes the client sent, which exceeds `bytes.length` when truncated. */
  size: number;
  truncated: boolean;
};

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
 * 200 once the row is written. A body over `MAX_BODY_BYTES` is stored up to
 * that limit with `truncated` set and answered 413. An unknown or inactive slug
 * gets a 404 and nothing is stored.
 *
 * Routes are registered inside their own plugin scope so that replacing the
 * body parser with one that keeps raw bytes does not affect the JSON parsing
 * the rest of the API relies on.
 */
export function registerCaptureRoutes(app: FastifyInstance, db: Db): void {
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_request, payload, done) => {
      const kept: Buffer[] = [];
      let keptBytes = 0;
      let size = 0;

      payload.on('data', (chunk: Buffer) => {
        size += chunk.byteLength;
        if (keptBytes >= MAX_BODY_BYTES) return;

        const room = MAX_BODY_BYTES - keptBytes;
        const slice = chunk.byteLength <= room ? chunk : chunk.subarray(0, room);
        kept.push(slice);
        keptBytes += slice.byteLength;
      });

      payload.on('error', done);
      payload.on('end', () => {
        done(null, { bytes: Buffer.concat(kept), size, truncated: size > MAX_BODY_BYTES });
      });
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

      const body = (request.body as CapturedBody | undefined) ?? {
        bytes: Buffer.alloc(0),
        size: 0,
        truncated: false,
      };

      const [row] = await db
        .insert(requests)
        .values({
          binId: bin.id,
          method: request.method,
          path: request.url.split('?')[0]!,
          query: request.query as Record<string, string | string[]>,
          headers: flattenHeaders(request),
          body: body.bytes,
          bodySize: body.size,
          truncated: body.truncated,
          contentType: request.headers['content-type'] ?? null,
          sourceIp: request.ip,
        })
        .returning({ id: requests.id, receivedAt: requests.receivedAt });

      if (body.truncated) {
        return reply.code(413).send({
          error: 'body_too_large',
          limit: MAX_BODY_BYTES,
          id: row!.id,
        });
      }

      return reply.code(200).send({ id: row!.id, receivedAt: row!.receivedAt });
    };

    scope.route({ method: METHODS, url: '/i/:slug', handler });
    scope.route({ method: METHODS, url: '/i/:slug/*', handler });
  });
}
