import { requests, type Db } from '@wi/db';
import { inArray, lt, sql } from 'drizzle-orm';

const BATCH = 1_000;

/**
 * Deletes requests older than `days`, a batch at a time.
 *
 * Returns how many rows were removed. Batching keeps each statement short, so a
 * backlog cannot hold a lock long enough to stall captures. Deliveries go with
 * their request through the foreign key.
 */
export async function pruneRequests(db: Db, days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  let removed = 0;

  for (;;) {
    const doomed = await db
      .select({ id: requests.id })
      .from(requests)
      .where(lt(requests.receivedAt, cutoff))
      .limit(BATCH);

    if (doomed.length === 0) return removed;

    await db.delete(requests).where(
      inArray(
        requests.id,
        doomed.map((row) => row.id),
      ),
    );
    removed += doomed.length;

    if (doomed.length < BATCH) return removed;
  }
}

/** Counts rows worth watching: captures, delivery states, and the queue depth. */
export async function collectMetrics(db: Db): Promise<Record<string, number>> {
  const [row] = await db.execute<Record<string, string>>(sql`
    select
      (select count(*) from requests) as requests_total,
      (select count(*) from requests where received_at > now() - interval '1 hour') as requests_last_hour,
      (select count(*) from deliveries where state = 'sent') as deliveries_sent,
      (select count(*) from deliveries where state = 'dead') as deliveries_dead,
      (select count(*) from deliveries where state in ('pending', 'sending')) as deliveries_queued,
      (select count(*) from bins) as bins_total
  `);

  return Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, Number(value)]));
}
