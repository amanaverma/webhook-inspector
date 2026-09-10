import type { Db } from '@wi/db';
import { sql } from 'drizzle-orm';

export const CHANNEL = 'new_request';

export type NewRequestNotice = { binId: string; requestId: string };

/**
 * Announces a stored request to every process listening on `CHANNEL`.
 *
 * Only the two ids travel, because Postgres drops a NOTIFY payload over 8000
 * bytes and a captured body can be a megabyte. Listeners read the row they need.
 */
export async function notifyNewRequest(db: Db, notice: NewRequestNotice): Promise<void> {
  await db.execute(sql`select pg_notify(${CHANNEL}, ${JSON.stringify(notice)})`);
}

/** Returns the notice carried by a NOTIFY payload, or null if it is not one of ours. */
export function parseNotice(payload: string): NewRequestNotice | null {
  try {
    const parsed = JSON.parse(payload) as Partial<NewRequestNotice>;
    if (typeof parsed.binId !== 'string' || typeof parsed.requestId !== 'string') return null;
    return { binId: parsed.binId, requestId: parsed.requestId };
  } catch {
    return null;
  }
}
