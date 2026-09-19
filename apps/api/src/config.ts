import { isIP } from 'node:net';

/** Proxy sets `x-forwarded-for` entries that proxy-addr accepts by name rather than address. */
const NAMED_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

/**
 * Reads which proxies may set `x-forwarded-for`.
 *
 * Returns false when unset or `false`, and otherwise the addresses and ranges
 * given, as a list proxy-addr accepts: `10.0.0.0/8`, `loopback`, `linklocal`,
 * `uniquelocal`.
 *
 * Throws for `true` and for a bare number, neither of which names a proxy.
 */
function readTrustProxy(value: string | undefined): false | string {
  if (value === undefined || value === '') return false;

  if (value === 'false') return false;

  if (value === 'true' || /^\d+$/.test(value)) {
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
 * Throws unless the environment has what the API needs to serve safely.
 *
 * Call from the API process only. The worker shares `loadConfig` but serves
 * nothing, so neither of these applies to it.
 */
export function assertApiConfig(config: Config, env: NodeJS.ProcessEnv = process.env): void {
  if (!config.production) return;

  if (!config.redisUrl) {
    throw new Error('REDIS_URL is not set, which would leave capture, login and signup with no rate limit');
  }
  if (!env.METRICS_TOKEN) {
    throw new Error('METRICS_TOKEN is not set, which would leave /metrics open to anyone');
  }
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

  // A deployment that never sets NODE_ENV gets the development defaults, so this
  // is checked rather than assumed: it is silent otherwise.
  const production = env.NODE_ENV === 'production';
  if (production && env.FORWARD_ALLOW_PRIVATE === 'true') {
    throw new Error('FORWARD_ALLOW_PRIVATE lets a bin forward to loopback and cloud metadata, so it cannot be set in production');
  }

  return {
    production,
    databaseUrl,
    port,
    host: env.HOST ?? '0.0.0.0',
    redisUrl: env.REDIS_URL ?? null,
    trustProxy: readTrustProxy(env.TRUST_PROXY),
    retentionDays,
  } as const;
}

export type Config = ReturnType<typeof loadConfig>;
