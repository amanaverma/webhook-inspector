import type { Db } from '@wi/db';
import { claimDue, recordAttempt, type Attempt, type ClaimedDelivery } from './queue.js';

const TIMEOUT_MS = 10_000;
const BATCH = 10;

/** Headers that describe the old hop rather than the payload, so they are not forwarded. */
const SKIP_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'expect',
]);

/**
 * Sends one claimed delivery to its target.
 *
 * Returns the response status, or a null status with the error text when the
 * target could not be reached or did not answer within the timeout.
 */
export async function deliver(claimed: ClaimedDelivery): Promise<Attempt> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(claimed.headers)) {
    if (!SKIP_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  headers['x-webhook-inspector-attempt'] = String(claimed.attempt);
  headers['x-webhook-inspector-request-id'] = claimed.requestId;

  const started = Date.now();
  try {
    const response = await fetch(claimed.targetUrl, {
      method: claimed.method,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
      ...(claimed.body.byteLength > 0 ? { body: new Uint8Array(claimed.body) } : {}),
    });
    await response.arrayBuffer();
    return { status: response.status, durationMs: Date.now() - started, error: null };
  } catch (error) {
    return {
      status: null,
      durationMs: Date.now() - started,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

/**
 * Claims every delivery that is due and attempts each one.
 *
 * Returns how many were attempted, so a caller can keep ticking while there is
 * work rather than waiting for the next interval.
 */
export async function runOnce(db: Db): Promise<number> {
  const claimed = await claimDue(db, BATCH);
  await Promise.all(claimed.map(async (delivery) => recordAttempt(db, delivery, await deliver(delivery))));
  return claimed.length;
}

/**
 * Runs `runOnce` on an interval until the returned function is called.
 *
 * Ticks never overlap: a slow batch delays the next tick rather than running
 * beside it.
 */
export function startWorker(db: Db, intervalMs = 1_000): () => Promise<void> {
  let stopped = false;
  let running: Promise<unknown> = Promise.resolve();

  const timer = setInterval(() => {
    if (stopped) return;
    running = running.then(() => (stopped ? undefined : runOnce(db))).catch((error) => {
      console.error('delivery tick failed', error);
    });
  }, intervalMs);

  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
