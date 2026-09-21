import type { Redis } from 'ioredis';

export const CAPACITY = 120;
export const REFILL_PER_SECOND = 2;

/** Login is far rarer than capture, so its buckets are small and refill slowly. */
export const LOGIN_CAPACITY = 10;
export const LOGIN_REFILL_PER_SECOND = 0.05;

/** A single client may work through several accounts before it is stopped. */
export const LOGIN_IP_CAPACITY = 40;
export const LOGIN_IP_REFILL_PER_SECOND = 0.2;

/**
 * Refills the bucket by elapsed time, spends `cost` tokens when at least one is
 * available, and reports the result.
 *
 * Runs as one Lua script so the read, the refill and the spend cannot interleave
 * with another request. Returns whether a token was available and how many are
 * left. A cost of 0 checks the bucket without spending from it.
 */
const SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'updated')
local tokens = tonumber(bucket[1])
local updated = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  updated = now
end

tokens = math.min(capacity, tokens + (now - updated) * refill)

local allowed = 0
if tokens >= 1 then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'updated', now)
redis.call('EXPIRE', key, math.ceil(capacity / refill) * 2)

return { allowed, math.floor(tokens) }
`;

export type RateLimitResult = { allowed: boolean; remaining: number };

async function runBucket(
  redis: Redis,
  key: string,
  capacity: number,
  refillPerSecond: number,
  cost: 0 | 1,
): Promise<RateLimitResult> {
  try {
    const [allowed, remaining] = (await redis.eval(
      SCRIPT,
      1,
      key,
      capacity,
      refillPerSecond,
      Date.now() / 1000,
      cost,
    )) as [number, number];

    return { allowed: allowed === 1, remaining };
  } catch {
    return { allowed: true, remaining: capacity };
  }
}

/**
 * Spends one token from the bucket named by `key`.
 *
 * Allows the request when Redis is unreachable, because dropping real webhooks
 * is worse than briefly serving an unlimited number of them.
 */
export async function spendToken(
  redis: Redis,
  key: string,
  capacity = CAPACITY,
  refillPerSecond = REFILL_PER_SECOND,
): Promise<RateLimitResult> {
  return runBucket(redis, key, capacity, refillPerSecond, 1);
}

/**
 * Reports whether the bucket named by `key` has a token, without spending one.
 *
 * Allows the request when Redis is unreachable, the same as `spendToken`.
 */
export async function hasToken(
  redis: Redis,
  key: string,
  capacity = CAPACITY,
  refillPerSecond = REFILL_PER_SECOND,
): Promise<RateLimitResult> {
  return runBucket(redis, key, capacity, refillPerSecond, 0);
}
