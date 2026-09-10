import { deliveries, requests, type Db, type Delivery } from '@wi/db';
import { sql } from 'drizzle-orm';
import { backoffMs, isRetryable, MAX_ATTEMPTS } from './backoff.js';

/** How long a claimed delivery may stay unfinished before another worker takes it. */
const STALE_AFTER = sql`interval '2 minutes'`;

export type Attempt = {
  status: number | null;
  durationMs: number;
  error: string | null;
};

/**
 * Queues the first delivery attempt for a captured request.
 *
 * Does nothing if that attempt already exists, which is what makes a capture
 * retried by the caller, or replayed after a crash, deliver once rather than
 * twice.
 */
export async function enqueue(db: Db, requestId: string, targetUrl: string): Promise<void> {
  await db
    .insert(deliveries)
    .values({ requestId, targetUrl, attempt: 1, dedupeKey: `${requestId}:1` })
    .onConflictDoNothing({ target: deliveries.dedupeKey });
}

/**
 * Queues a manual replay, which is always a fresh attempt.
 *
 * Returns the queued row. Unlike `enqueue`, repeated calls each produce a
 * delivery, because a person asking twice means it twice.
 */
export async function enqueueReplay(db: Db, requestId: string, targetUrl: string): Promise<Delivery> {
  const [row] = await db
    .insert(deliveries)
    .values({
      requestId,
      targetUrl,
      attempt: 1,
      dedupeKey: `${requestId}:replay:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  return row!;
}

export type ClaimedDelivery = {
  id: string;
  requestId: string;
  targetUrl: string;
  attempt: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Buffer;
};

/**
 * Claims up to `limit` deliveries that are due, marking them `sending`.
 *
 * Rows already locked by another worker are skipped rather than waited on, so
 * several workers share the queue without blocking each other and without one
 * row being handed to two of them.
 *
 * A row left in `sending` for longer than `STALE_AFTER` is claimed again,
 * because a worker that died mid attempt cannot release it itself. The target
 * may therefore see the same delivery twice, which is the cost of guaranteeing
 * it sees it at least once.
 *
 * Columns are aliased because this runs as raw SQL, which returns the database
 * names rather than the camel case ones the schema maps to.
 */
export async function claimDue(db: Db, limit: number): Promise<ClaimedDelivery[]> {
  const rows = await db.execute<ClaimedDelivery>(sql`
    with due as (
      select id from ${deliveries}
      where (state = 'pending' and next_attempt_at <= now())
         or (state = 'sending' and updated_at < now() - ${STALE_AFTER})
      order by next_attempt_at
      for update skip locked
      limit ${limit}
    )
    update ${deliveries} d
    set state = 'sending', updated_at = now()
    from due, ${requests} r
    where d.id = due.id and r.id = d.request_id
    returning d.id, d.request_id as "requestId", d.target_url as "targetUrl", d.attempt,
              r.method, r.path, r.headers, r.body
  `);

  return rows as unknown as ClaimedDelivery[];
}

/**
 * Records the outcome of an attempt and schedules a retry when one is due.
 *
 * A success ends the delivery. A retryable failure with attempts left inserts
 * the next attempt with its backoff already applied; otherwise the delivery is
 * marked dead.
 */
export async function recordAttempt(db: Db, claimed: ClaimedDelivery, attempt: Attempt): Promise<void> {
  const succeeded = attempt.status !== null && attempt.status >= 200 && attempt.status < 400;
  const canRetry = !succeeded && isRetryable(attempt.status) && claimed.attempt < MAX_ATTEMPTS;

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      update ${deliveries}
      set state = ${succeeded ? 'sent' : canRetry ? 'failed' : 'dead'},
          response_status = ${attempt.status},
          duration_ms = ${attempt.durationMs},
          error = ${attempt.error},
          updated_at = now()
      where id = ${claimed.id}
    `);

    if (!canRetry) return;

    const next = claimed.attempt + 1;
    await tx
      .insert(deliveries)
      .values({
        requestId: claimed.requestId,
        targetUrl: claimed.targetUrl,
        attempt: next,
        dedupeKey: `${claimed.requestId}:${next}`,
        nextAttemptAt: new Date(Date.now() + backoffMs(claimed.attempt)),
      })
      .onConflictDoNothing({ target: deliveries.dedupeKey });
  });
}
