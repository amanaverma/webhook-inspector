import type { Db } from '@wi/db';
import { Agent, fetch } from 'undici';
import { claimDue, recordAttempt, type Attempt, type ClaimedDelivery } from './queue.js';
import { checkTargetUrl, guardedLookup } from './target-url.js';

const TIMEOUT_MS = 10_000;

/** Sends every attempt through a connection whose own address lookup is checked. */
const dispatcher = new Agent({ connect: { lookup: guardedLookup } });
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
 * Builds the URL an attempt is sent to, or null when the captured path would
 * leave the target's own path.
 *
 * Whatever the provider addressed below `/i/<slug>` is appended to the target's
 * own path, and the captured query string is appended after the target's own
 * query exactly as it arrived. So a webhook sent to `/i/<slug>/events?b=2&a=1`
 * with a target of `https://example.com/hook?env=prod` is delivered to
 * `https://example.com/hook/events?env=prod&b=2&a=1`.
 *
 * A name present in both queries is sent twice, target first. When the row has
 * no raw query, the query is rebuilt from the parsed one instead, which loses
 * order and encoding and skips names the target already has.
 *
 * Returns null for a path holding `..` segments, since anyone who knows the
 * slug can choose that path, and resolving it would address a part of the
 * target the bin was never pointed at.
 */
export function deliveryUrl(claimed: ClaimedDelivery): string | null {
  const url = new URL(claimed.targetUrl);
  const base = url.pathname.replace(/\/$/, '');
  const prefix = `/i/${claimed.slug}`;
  const suffix = claimed.path.startsWith(prefix) ? claimed.path.slice(prefix.length) : '';

  if (suffix) {
    url.pathname = `${base}${suffix}`;
    // Assigning resolves `..` and its encoded spellings, so a path that no
    // longer sits under the target's own path was addressing something else.
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return null;
  }

  if (claimed.rawQuery !== null) {
    if (!claimed.rawQuery) return url.toString();
    url.hash = '';
    return `${url.toString()}${url.search ? '&' : '?'}${claimed.rawQuery}`;
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
 * target could not be reached or did not answer within the timeout. The
 * response body is discarded unread, so a target that answers and then trickles
 * its body still counts as the answer it gave.
 *
 * The target is checked again here rather than trusting the row, because a row
 * may hold a URL that was never checked. The connection then resolves the host
 * through `guardedLookup`, so a name that answers with a private address at
 * connect time is refused rather than called.
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

  const url = deliveryUrl(claimed);
  if (url === null) {
    return { status: null, durationMs: 0, error: 'capture path leaves the target path', terminal: true };
  }

  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: claimed.method,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
      dispatcher,
      ...(claimed.body.byteLength > 0 ? { body: new Uint8Array(claimed.body) } : {}),
    });
    void response.body?.cancel();
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
 * Returns how many were attempted. Waits for all of them, including any whose
 * bookkeeping write failed, so a caller knows nothing is still in flight when
 * this resolves.
 */
export async function runOnce(db: Db): Promise<number> {
  const claimed = await claimDue(db, BATCH);
  const results = await Promise.allSettled(
    claimed.map(async (delivery) => recordAttempt(db, delivery, await deliver(delivery))),
  );

  for (const result of results) {
    // A row whose outcome could not be written stays `sending` and is claimed
    // again once it goes stale, so it is logged rather than retried here.
    if (result.status === 'rejected') console.error('delivery attempt not recorded', result.reason);
  }

  return claimed.length;
}

/** Keeps claiming while a full batch comes back, so a backlog drains rather than waiting a tick per batch. */
async function drain(db: Db): Promise<void> {
  while ((await runOnce(db)) === BATCH);
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

    running = drain(db)
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
