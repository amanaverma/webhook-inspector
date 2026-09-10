import { bins, deliveries, requests, type Db } from '@wi/db';
import { and, asc, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { enqueueReplay } from '../delivery/queue.js';
import { encodeBody } from './body-encoding.js';
import { decodeCursor, encodeCursor } from './cursor.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchBinBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  forwardUrl: z.union([z.url().refine((value) => /^https?:/.test(value)), z.null()]).optional(),
  isActive: z.boolean().optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

/**
 * Registers the read endpoints for bins and their captured requests.
 *
 * Listing a bin's requests pages with a cursor rather than an offset, so a
 * request arriving mid-read cannot shift rows onto a page the caller already
 * fetched. `nextCursor` is null on the last page.
 */
export function registerReadRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/bins', async () => {
    const rows = await db.select().from(bins).orderBy(desc(bins.createdAt));
    return { bins: rows };
  });

  app.get('/api/bins/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const [bin] = await db.select().from(bins).where(eq(bins.slug, slug)).limit(1);
    if (!bin) return reply.code(404).send({ error: 'not_found' });

    const [counted] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(requests)
      .where(eq(requests.binId, bin.id));

    return { ...bin, requestCount: counted?.count ?? 0 };
  });

  app.get('/api/bins/:slug/requests', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', details: z.treeifyError(parsed.error) });
    }

    const [bin] = await db.select({ id: bins.id }).from(bins).where(eq(bins.slug, slug)).limit(1);
    if (!bin) return reply.code(404).send({ error: 'not_found' });

    let after = undefined;
    if (parsed.data.cursor !== undefined) {
      const cursor = decodeCursor(parsed.data.cursor);
      if (!cursor) return reply.code(400).send({ error: 'invalid_cursor' });
      after = or(
        lt(requests.receivedAt, cursor.receivedAt),
        and(eq(requests.receivedAt, cursor.receivedAt), lt(requests.id, cursor.id)),
      );
    }

    const rows = await db
      .select({
        id: requests.id,
        method: requests.method,
        path: requests.path,
        query: requests.query,
        bodySize: requests.bodySize,
        truncated: requests.truncated,
        contentType: requests.contentType,
        sourceIp: requests.sourceIp,
        receivedAt: requests.receivedAt,
      })
      .from(requests)
      .where(and(eq(requests.binId, bin.id), after))
      .orderBy(desc(requests.receivedAt), desc(requests.id))
      .limit(parsed.data.limit + 1);

    const page = rows.slice(0, parsed.data.limit);
    const last = page.at(-1);

    return {
      requests: page,
      nextCursor: rows.length > parsed.data.limit && last ? encodeCursor(last) : null,
    };
  });

  app.get('/api/requests/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID.test(id)) return reply.code(400).send({ error: 'invalid_id' });

    const [row] = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'not_found' });

    const { body, ...rest } = row;
    const attempts = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.requestId, id))
      .orderBy(asc(deliveries.attempt), asc(deliveries.createdAt));

    return { ...rest, ...encodeBody(body, row.contentType), deliveries: attempts };
  });

  app.patch('/api/bins/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const parsed = patchBinBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: z.treeifyError(parsed.error) });
    }

    const [updated] = await db
      .update(bins)
      .set(parsed.data)
      .where(eq(bins.slug, slug))
      .returning();

    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return updated;
  });

  app.post('/api/requests/:id/replay', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID.test(id)) return reply.code(400).send({ error: 'invalid_id' });

    const [row] = await db
      .select({ binId: requests.binId, forwardUrl: bins.forwardUrl })
      .from(requests)
      .innerJoin(bins, eq(bins.id, requests.binId))
      .where(eq(requests.id, id))
      .limit(1);

    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (!row.forwardUrl) return reply.code(409).send({ error: 'no_forward_url' });

    return reply.code(202).send(await enqueueReplay(db, id, row.forwardUrl));
  });
}
