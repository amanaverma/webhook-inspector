import type { Db } from '@wi/db';
import { claimDue, recordAttempt, type Attempt, type ClaimedDelivery } from './queue.js';
import { checkTargetUrl } from './target-url.js';

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
 * Builds the URL an attempt is sent to.
 *
 * Whatever the provider addressed below `/i/<slug>` is appended to the target's
 * own path, and the captured query is merged in, with the target's own
 * parameters winning. So a webhook sent to `/i/<slug>/events?sig=abc` with a
 * target of `https://example.com/hook` is delivered to
 * `https://example.com/hook/events?sig=abc`.
 */
export function deliveryUrl(claimed: ClaimedDelivery): string {
  const url = new URL(claimed.targetUrl);
  const suffix = claimed.path.replace(`/i/${claimed.slug}`, '');

  if (suffix) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}${suffix}`;
  }

  for (const [key, value] of Object.entries(claimed.query ?? {})) {
    if (url.searchParams.has(key)) continue;
    for (const single of Array.isArray(value) ? value : [value]) {
      url.searchParams.append(key, single);
    }
  }

  return url.toString();
}

/**
 * Sends one claimed delivery to its target.
 *
 * Returns the response status, or a null status with the error text when the
 * target could not be reached or did not answer within the timeout.
 *
 * The target is checked again here rather than trusting the row, because a row
 * may predate the check, and because a hostname can resolve to a private
 * address only at the moment it is called.
 */
export async function deliver(claimed: ClaimedDelivery): Promise<Attempt> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(claimed.headers)) {
    if (!SKIP_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  headers['x-webhook-inspector-attempt'] = String(claimed.attempt);
  headers['x-webhook-inspector-request-id'] = claimed.requestId;

  const target = await checkTargetUrl(claimed.targetUrl);
  if (!target.ok) {
    return { status: null, durationMs: 0, error: `blocked target: ${target.reason}`, terminal: true };
  }

  const started = Date.now();
  try {
    const response = await fetch(deliveryUrl(claimed), {
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
 * Ticks never overlap, and a tick that arrives during a slow batch is skipped
 * rather than queued behind it.
 */
export function startWorker(db: Db, intervalMs = 1_000): () => Promise<void> {
  let stopped = false;
  let running: Promise<unknown> | null = null;

  const timer = setInterval(() => {
    // A tick that arrives while the previous one is still working is dropped
    // rather than queued, so slow targets cannot build a backlog of ticks that
    // all run back to back once the targets recover.
    if (stopped || running) return;

    running = runOnce(db)
      .catch((error: unknown) => {
        console.error('delivery tick failed', error);
      })
      .finally(() => {
        running = null;
      });
  }, intervalMs);

  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
