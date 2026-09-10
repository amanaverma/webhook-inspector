import { describe, expect, it } from 'vitest';
import { backoffMs, isRetryable, MAX_ATTEMPTS } from './backoff.js';

describe('backoffMs', () => {
  it('grows with each attempt', () => {
    expect([1, 2, 3, 4, 5].map((attempt) => backoffMs(attempt, () => 0)))
      .toEqual([1_000, 4_000, 15_000, 60_000, 300_000]);
  });

  it('adds up to 20 percent of jitter', () => {
    expect(backoffMs(1, () => 0)).toBe(1_000);
    expect(backoffMs(1, () => 1)).toBe(1_200);
    expect(backoffMs(1, () => 0.5)).toBe(1_100);
  });

  it('holds the last delay for an attempt past the table', () => {
    expect(backoffMs(MAX_ATTEMPTS + 3, () => 0)).toBe(300_000);
  });
});

describe('isRetryable', () => {
  it('retries timeouts and transport failures', () => {
    expect(isRetryable(null)).toBe(true);
  });

  it('retries 5xx, 408 and 429', () => {
    for (const status of [500, 502, 503, 408, 429]) expect(isRetryable(status), String(status)).toBe(true);
  });

  it('gives up on other 4xx', () => {
    for (const status of [400, 401, 403, 404, 422]) expect(isRetryable(status), String(status)).toBe(false);
  });
});
