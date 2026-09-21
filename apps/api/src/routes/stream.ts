import { bins, createListenClient, requests, type Db } from '@wi/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { loadOwnedBin } from '../auth/ownership.js';
import { CHANNEL, parseNotice } from '../notify.js';

const HEARTBEAT_MS = 15_000;
const BACKFILL_LIMIT = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Subscriber = (requestId: string) => void;

/**
 * Registers the live tail endpoint at `/api/bins/:slug/stream`.
 *
 * Holds one Postgres LISTEN connection for the process and fans notifications
 * out to the browsers watching each bin. A client reconnecting with
 * `Last-Event-ID` receives the requests it missed, up to 100, before the live
 * feed resumes.
 *
 * Each stream is removed when its client disconnects, including one that leaves
 * before the first event is written.
 *
 * Registered as a plugin so the listen connection is opened during
 * `app.ready()` rather than on the first request.
 */
export function registerStreamRoutes(app: FastifyInstance, db: Db, databaseUrl: string): void {
  void app.register(async (scope) => {
    const subscribers = new Map<string, Set<Subscriber>>();
    const open = new Set<{ end: () => void }>();
    const listener = createListenClient(databaseUrl);

    await listener.listen(CHANNEL, (payload) => {
      const notice = parseNotice(payload);
      if (!notice) return;
      for (const send of subscribers.get(notice.binId) ?? []) send(notice.requestId);
    });

    // Ends every stream before the server stops accepting connections, since an
    // event stream is never idle and would otherwise hold shutdown open until
    // the platform kills the process.
    scope.addHook('preClose', async () => {
      for (const stream of open) stream.end();
      open.clear();
    });

    scope.addHook('onClose', async () => {
      await listener.end();
    });

    const summary = {
      id: requests.id,
      method: requests.method,
      path: requests.path,
      query: requests.query,
      bodySize: requests.bodySize,
      truncated: requests.truncated,
      contentType: requests.contentType,
      sourceIp: requests.sourceIp,
      receivedAt: requests.receivedAt,
    };

    scope.get('/api/bins/:slug/stream', async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const bin = await loadOwnedBin(db, slug, request.user);
      if (!bin) return reply.code(404).send({ error: 'not_found' });

      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Tells nginx and similar proxies to forward each event as it is written.
        'x-accel-buffering': 'no',
      });
      reply.raw.write(': connected\n\n');

      const sendRow = (row: Record<string, unknown> & { id: string }) => {
        reply.raw.write(`id: ${row.id}\ndata: ${JSON.stringify(row)}\n\n`);
      };

      const lastEventId = request.headers['last-event-id'];
      if (typeof lastEventId === 'string' && UUID.test(lastEventId)) {
        // The comparison stays in SQL because received_at holds microseconds,
        // which a JavaScript Date truncates, making the cursor row compare as
        // newer than itself.
        const missed = await db
          .select(summary)
          .from(requests)
          .where(
            and(
              eq(requests.binId, bin.id),
              sql`(${requests.receivedAt}, ${requests.id}) > (select received_at, id from ${requests} where id = ${lastEventId}::uuid)`,
            ),
          )
          .orderBy(asc(requests.receivedAt), asc(requests.id))
          .limit(BACKFILL_LIMIT);

        for (const row of missed) sendRow(row);
      }

      const send: Subscriber = (requestId) => {
        void db
          .select(summary)
          .from(requests)
          .where(eq(requests.id, requestId))
          .limit(1)
          .then(([row]) => {
            if (row) sendRow(row);
          })
          .catch((error: unknown) => {
            // One stream failing to read a row must not reject into the process,
            // which would end every other stream with it.
            request.log.error({ err: error, requestId }, 'live tail could not read a request');
          });
      };

      // A client that leaves during the lookup or the backfill has already had
      // its close event, and it never fires twice, so anything registered after
      // this point would stay registered for the life of the process.
      if (request.raw.destroyed) return reply;

      const entry = { end: () => reply.raw.end() };
      open.add(entry);

      const watchers = subscribers.get(bin.id) ?? new Set<Subscriber>();
      watchers.add(send);
      subscribers.set(bin.id, watchers);

      const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), HEARTBEAT_MS);

      request.raw.on('close', () => {
        clearInterval(heartbeat);
        open.delete(entry);
        watchers.delete(send);
        if (watchers.size === 0) subscribers.delete(bin.id);
      });

      return reply;
    });
  });
}
