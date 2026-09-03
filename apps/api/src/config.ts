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

  return { databaseUrl, port, host: env.HOST ?? '0.0.0.0' } as const;
}

export type Config = ReturnType<typeof loadConfig>;
