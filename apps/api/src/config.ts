import { isIP } from 'node:net';

/** Proxy sets `x-forwarded-for` entries that proxy-addr accepts by name rather than address. */
const NAMED_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

/**
 * Reads which proxies may set `x-forwarded-for`.
 *
 * Returns false when unset, or the addresses and ranges given, as a list
 * proxy-addr accepts: `10.0.0.0/8`, `loopback`, `linklocal`, `uniquelocal`.
 *
 * Throws for `true` and for a bare number. Trusting every hop takes the
 * leftmost entry of the header, which the client writes, so every limit keyed
 * on an address becomes one the caller chooses; and Fastify trusts nothing at
 * all when given a hop count, which would leave the header ignored while
 * looking configured.
 */
function readTrustProxy(value: string | undefined): false | string {
  if (value === undefined || value === '') return false;

  if (value === 'true' || value === 'false' || /^\d+$/.test(value)) {
    throw new Error(`TRUST_PROXY takes the addresses or ranges of the proxies in front of this process, such as 10.0.0.0/8, got ${value}`);
  }

  for (const entry of value.split(',')) {
    const address = entry.trim().split('/')[0]!;
    if (NAMED_RANGES.has(entry.trim()) || isIP(address)) continue;
    throw new Error(`TRUST_PROXY holds something that is not an address, a range or a known name: ${entry.trim()}`);
  }

  return value;
}

/**
 * Reads the process environment into a typed config object.
 *
 * Throws if a required variable is missing or malformed, so a misconfigured
 * process fails at startup rather than on the first request that needs the
 * value.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got ${env.PORT}`);
  }

  const retentionDays = Number(env.RETENTION_DAYS ?? 7);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error(`RETENTION_DAYS must be a positive integer, got ${env.RETENTION_DAYS}`);
  }

  return {
    databaseUrl,
    port,
    host: env.HOST ?? '0.0.0.0',
    redisUrl: env.REDIS_URL ?? null,
    trustProxy: readTrustProxy(env.TRUST_PROXY),
    retentionDays,
  } as const;
}

export type Config = ReturnType<typeof loadConfig>;
