export const MAX_ATTEMPTS = 5;

const BASE_DELAYS_MS = [1_000, 4_000, 15_000, 60_000, 300_000];

/**
 * Returns how long to wait before the next attempt, in milliseconds.
 *
 * `attempt` is the attempt that just failed, counting from 1. The delay grows
 * with each attempt and carries up to 20 percent of random jitter, so a batch
 * of deliveries that failed together does not retry in lockstep.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = BASE_DELAYS_MS[Math.min(attempt, BASE_DELAYS_MS.length) - 1]!;
  return Math.round(base * (1 + random() * 0.2));
}

/**
 * Decides whether a target's response is worth another attempt.
 *
 * A 4xx other than 408 and 429 means the payload itself is wrong, so retrying
 * only burns attempts. Everything else, including a timeout or a DNS failure
 * arriving here as a null status, is treated as temporary.
 */
export function isRetryable(status: number | null): boolean {
  if (status === null) return true;
  if (status === 408 || status === 429) return true;
  return status < 400 || status >= 500;
}
