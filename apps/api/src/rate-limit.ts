import type { Redis } from 'ioredis';

export const CAPACITY = 120;
export const REFILL_PER_SECOND = 2;

/**
 * Refills the bucket by elapsed time, spends one token, and reports the result.
 *
 * Runs as one Lua script so the read, the refill and the spend cannot interleave
 * with another request. Returns whether the caller may proceed and how many
 * tokens are left.
 */
const SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

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
  tokens = tokens - 1
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'updated', now)
redis.call('EXPIRE', key, math.ceil(capacity / refill) * 2)

return { allowed, math.floor(tokens) }
`;

export type RateLimitResult = { allowed: boolean; remaining: number };

/**
 * Spends one token from the bucket named by `key`.
 *
 * Allows the request when Redis is unreachable, because dropping real webhooks
 * is worse than briefly serving an unlimited number of them.
 */
export async function spendToken(redis: Redis, key: string): Promise<RateLimitResult> {
  try {
    const [allowed, remaining] = (await redis.eval(
      SCRIPT,
      1,
      key,
      CAPACITY,
      REFILL_PER_SECOND,
      Date.now() / 1000,
    )) as [number, number];

    return { allowed: allowed === 1, remaining };
  } catch {
    return { allowed: true, remaining: CAPACITY };
  }
}
