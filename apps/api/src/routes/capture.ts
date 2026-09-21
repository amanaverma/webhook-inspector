import { bins, requests, type Db } from '@wi/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify';
import type { Redis } from 'ioredis';
import { COOKIE_NAME } from '../auth/session.js';
import { enqueue } from '../delivery/queue.js';
import { hasToken, spendToken } from '../rate-limit.js';
import { notifyNewRequest } from '../notify.js';

const METHODS: HTTPMethods[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** A whole `type/subtype` header with its parameters, in the characters RFC 9110 allows. */
const MEDIA_TYPE = /^[!#$%&'*+\-.^_`|~\w]+\/[!#$%&'*+\-.^_`|~\w]+\s*(;.*)?$/s;

declare module 'fastify' {
  interface FastifyRequest {
    /** The content type as sent, when it was not a media type Fastify would accept. */
    sentContentType: string | null;
  }
}

export const MAX_BODY_BYTES = 1_048_576;

/**
 * The largest upload read at all, past which the request is refused.
 *
 * A body over `MAX_BODY_BYTES` is still stored up to that cap and reported with
 * its real size, which is why this ceiling sits above it rather than at it.
 */
export const MAX_UPLOAD_BYTES = 8 * MAX_BODY_BYTES;

type CapturedBody = {
  /** The first `MAX_BODY_BYTES` bytes of the body. */
  bytes: Buffer;
  /** Total bytes the client sent, which exceeds `bytes.length` when truncated. */
  size: number;
  truncated: boolean;
};

/**
 * Returns the request headers as stored for a capture.
 *
 * Header values Fastify may hand over as an array are joined with a comma, as on
 * the wire. This app's own session cookie is removed and any other cookies are
 * kept, so a signed in user who opens someone's capture URL in their browser
 * does not hand that bin's owner their session.
 */
function flattenHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  if (request.sentContentType !== null) headers['content-type'] = request.sentContentType;

  if (headers.cookie !== undefined) {
    const kept = headers.cookie
      .split(';')
      .filter((pair) => pair.split('=')[0]!.trim() !== COOKIE_NAME)
      .join(';')
      .trim();
    if (kept) headers.cookie = kept;
    else delete headers.cookie;
  }

  return headers;
}

/**
 * Registers the capture endpoint on `/i/:slug` and every path below it.
 *
 * Stores the request as it arrived, including the unparsed body, and answers
 * 200 once the row is written. A body over `MAX_BODY_BYTES` is stored up to
 * that limit with `truncated` set and answered 413, and is never forwarded,
 * since the target would receive something the provider did not send. A body
 * over `MAX_UPLOAD_BYTES` is refused with 413 and stored not at all, so one
 * sender cannot hold the process reading forever. An unknown or inactive slug
 * gets a 404 and nothing is stored.
 *
 * Routes are registered inside their own plugin scope so that replacing the
 * body parser with one that keeps raw bytes does not affect the JSON parsing
 * the rest of the API relies on.
 */
export function registerCaptureRoutes(app: FastifyInstance, db: Db, redis: Redis | null): void {
  void app.register(async (scope) => {
    // Fastify answers 415 for a header that is not a media type before any
    // parser runs, which would drop exactly the malformed senders this endpoint
    // exists to show. The header is replaced with one that parses and the
    // original is kept for the stored row.
    scope.decorateRequest('sentContentType', null);
    scope.addHook('onRequest', async (request) => {
      const sent = request.headers['content-type'];
      if (sent === undefined || MEDIA_TYPE.test(sent)) return;

      request.sentContentType = sent;
      request.headers['content-type'] = 'application/octet-stream';
    });

    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_request, payload, done) => {
      const kept: Buffer[] = [];
      let keptBytes = 0;
      let size = 0;
      let refused = false;

      payload.on('data', (chunk: Buffer) => {
        if (refused) return;
        size += chunk.byteLength;

        if (size > MAX_UPLOAD_BYTES) {
          refused = true;
          payload.destroy();
          done(Object.assign(new Error('body over the upload ceiling'), { statusCode: 413 }));
          return;
        }

        if (keptBytes >= MAX_BODY_BYTES) return;

        const room = MAX_BODY_BYTES - keptBytes;
        const slice = chunk.byteLength <= room ? chunk : chunk.subarray(0, room);
        kept.push(slice);
        keptBytes += slice.byteLength;
      });

      payload.on('error', (error) => {
        if (!refused) done(error);
      });
      payload.on('end', () => {
        if (refused) return;
        done(null, { bytes: Buffer.concat(kept), size, truncated: size > MAX_BODY_BYTES });
      });
    });

    const handler = async (request: FastifyRequest, reply: FastifyReply) => {
      const { slug } = request.params as { slug: string };

      // A client that keeps posting to slugs that do not exist is refused before
      // the lookup, so its flood costs a Redis call rather than a query each.
      // Only misses spend from this bucket, so traffic to real bins from the
      // same address never drains it.
      const missKey = `rl:miss:${request.ip}`;
      if (redis && !(await hasToken(redis, missKey)).allowed) {
        return reply.code(429).send({ error: 'rate_limited' });
      }

      const [bin] = await db
        .select({ id: bins.id, forwardUrl: bins.forwardUrl })
        .from(bins)
        .where(and(eq(bins.slug, slug), eq(bins.isActive, true)))
        .limit(1);

      if (!bin) {
        if (redis) await spendToken(redis, missKey);
        return reply.code(404).send({ error: 'unknown_bin' });
      }

      if (redis) {
        const limit = await spendToken(redis, `rl:bin:${slug}`);
        reply.header('x-ratelimit-remaining', String(limit.remaining));
        if (!limit.allowed) {
          return reply.code(429).send({ error: 'rate_limited' });
        }
      }

      const body = (request.body as CapturedBody | undefined) ?? {
        bytes: Buffer.alloc(0),
        size: 0,
        truncated: false,
      };

      const queryStart = request.url.indexOf('?');

      // The row and its first delivery are written together, so a failure
      // cannot leave a stored request that is never forwarded.
      const row = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(requests)
          .values({
            binId: bin.id,
            method: request.method,
            path: queryStart === -1 ? request.url : request.url.slice(0, queryStart),
            query: request.query as Record<string, string | string[]>,
            rawQuery: queryStart === -1 ? null : request.url.slice(queryStart + 1),
            headers: flattenHeaders(request),
            body: body.bytes,
            bodySize: body.size,
            truncated: body.truncated,
            contentType: request.sentContentType ?? request.headers['content-type'] ?? null,
            sourceIp: request.ip,
          })
          .returning({ id: requests.id, receivedAt: requests.receivedAt });

        if (bin.forwardUrl && !body.truncated) await enqueue(tx, inserted!.id, bin.forwardUrl);
        return inserted!;
      });

      await notifyNewRequest(db, { binId: bin.id, requestId: row.id });

      if (body.truncated) {
        return reply.code(413).send({
          error: 'body_too_large',
          limit: MAX_BODY_BYTES,
          id: row.id,
        });
      }

      return reply.code(200).send({ id: row.id, receivedAt: row.receivedAt });
    };

    scope.route({ method: METHODS, url: '/i/:slug', handler });
    scope.route({ method: METHODS, url: '/i/:slug/*', handler });
  });
}
