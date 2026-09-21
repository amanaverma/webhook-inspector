import { bins, deliveries, requests, type Db, type Delivery } from '@wi/db';

/** The transaction handle Drizzle passes to a `db.transaction` callback. */
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
import { sql } from 'drizzle-orm';
import { backoffMs, isRetryable, MAX_ATTEMPTS } from './backoff.js';

/** How long a claimed delivery may stay unfinished before another worker takes it. */
const STALE_AFTER = sql`interval '2 minutes'`;

export type Attempt = {
  status: number | null;
  durationMs: number;
  error: string | null;
  /** Set when the failure cannot improve on a later attempt, such as a refused target. */
  terminal?: boolean;
};

/**
 * Queues the first delivery attempt for a captured request.
 *
 * Does nothing if that attempt already exists, which is what makes a capture
 * retried by the caller, or replayed after a crash, deliver once rather than
 * twice.
 */
export async function enqueue(db: Db | Transaction, requestId: string, targetUrl: string): Promise<void> {
  const chainKey = `${requestId}:capture`;
  await db
    .insert(deliveries)
    .values({ requestId, targetUrl, attempt: 1, chainKey, dedupeKey: `${chainKey}:1` })
    .onConflictDoNothing({ target: deliveries.dedupeKey });
}

/**
 * Queues a manual replay, which is always a fresh attempt.
 *
 * Returns the queued row. Unlike `enqueue`, repeated calls each produce a
 * delivery, because a person asking twice means it twice.
 */
export async function enqueueReplay(db: Db, requestId: string, targetUrl: string): Promise<Delivery> {
  const chainKey = `${requestId}:replay:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const [row] = await db
    .insert(deliveries)
    .values({
      requestId,
      targetUrl,
      attempt: 1,
      chainKey,
      dedupeKey: `${chainKey}:1`,
    })
    .returning();
  return row!;
}

export type ClaimedDelivery = {
  id: string;
  requestId: string;
  targetUrl: string;
  attempt: number;
  chainKey: string;
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  rawQuery: string | null;
  slug: string;
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
 * it sees it at least once. Each reclaim spends an attempt, and a row that has
 * spent them all is marked dead instead.
 *
 * Each row is sent to the bin's forward URL as it stands now, so changing that
 * URL redirects attempts already queued. A bin that is inactive or has no
 * forward URL is skipped, which leaves its queued rows pending until it has one
 * again.
 *
 * Columns are aliased because this runs as raw SQL, which returns the database
 * names rather than the camel case ones the schema maps to.
 */
export async function claimDue(db: Db, limit: number): Promise<ClaimedDelivery[]> {
  // A row that has used every attempt without recording one ends here rather
  // than being handed out again, so a delivery that kills whatever claims it
  // cannot be claimed for ever. Rows another worker holds are skipped rather
  // than waited on, the same as the claim below.
  await db.execute(sql`
    with spent as (
      select id from ${deliveries}
      where state = 'sending' and updated_at < now() - ${STALE_AFTER} and attempt >= ${MAX_ATTEMPTS}
      for update skip locked
      limit ${limit}
    )
    update ${deliveries} d
    set state = 'dead', updated_at = now(),
        error = 'no attempt was recorded before the worker stopped'
    from spent
    where d.id = spent.id
  `);

  const rows = await db.execute<ClaimedDelivery>(sql`
    with due as (
      select id from ${deliveries}
      where ((state = 'pending' and next_attempt_at <= now())
         or (state = 'sending' and updated_at < now() - ${STALE_AFTER}))
        and exists (
          select 1 from ${requests} r join ${bins} b on b.id = r.bin_id
          where r.id = request_id and b.is_active and b.forward_url is not null
        )
      order by next_attempt_at
      for update skip locked
      limit ${limit}
    )
    update ${deliveries} d
    set state = 'sending', updated_at = now(), target_url = b.forward_url,
        -- Reclaiming a row whose worker died spends an attempt, because the
        -- target may well have received it already.
        attempt = case when d.state = 'sending' then d.attempt + 1 else d.attempt end
    from due, ${requests} r, ${bins} b
    where d.id = due.id and r.id = d.request_id and b.id = r.bin_id
    returning d.id, d.request_id as "requestId", d.target_url as "targetUrl", d.attempt,
              d.chain_key as "chainKey",
              r.method, r.path, r.query, r.raw_query as "rawQuery", r.headers, r.body, b.slug
  `);

  return rows as unknown as ClaimedDelivery[];
}

/**
 * Records the outcome of an attempt and schedules a retry when one is due.
 *
 * A success ends the delivery. A retryable failure with attempts left inserts
 * the next attempt with its backoff already applied; otherwise the delivery is
 * marked dead. The retry stays in the claimed row's own chain, so a capture and
 * a replay of the same request retry without displacing each other.
 *
 * Does nothing when the row has been claimed by another worker since, because
 * that worker is the one whose attempt counts.
 */
export async function recordAttempt(db: Db, claimed: ClaimedDelivery, attempt: Attempt): Promise<void> {
  const succeeded = attempt.status !== null && attempt.status >= 200 && attempt.status < 400;
  const canRetry =
    !succeeded && !attempt.terminal && isRetryable(attempt.status) && claimed.attempt < MAX_ATTEMPTS;

  await db.transaction(async (tx) => {
    // Matching on the attempt as well as the id means a row another worker has
    // already reclaimed is left alone: that worker owns the outcome now, and
    // writing here would both overwrite it and queue a second retry beside it.
    const written = await tx.execute(sql`
      update ${deliveries}
      set state = ${succeeded ? 'sent' : canRetry ? 'failed' : 'dead'},
          response_status = ${attempt.status},
          duration_ms = ${attempt.durationMs},
          error = ${attempt.error},
          updated_at = now()
      where id = ${claimed.id} and attempt = ${claimed.attempt}
      returning id
    `);

    if (written.length === 0 || !canRetry) return;

    const next = claimed.attempt + 1;
    await tx
      .insert(deliveries)
      .values({
        requestId: claimed.requestId,
        targetUrl: claimed.targetUrl,
        attempt: next,
        chainKey: claimed.chainKey,
        dedupeKey: `${claimed.chainKey}:${next}`,
        nextAttemptAt: new Date(Date.now() + backoffMs(claimed.attempt)),
      })
      .onConflictDoNothing({ target: deliveries.dedupeKey });
  });
}
