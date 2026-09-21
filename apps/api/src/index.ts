import { createDb } from '@wi/db';
import { Redis } from 'ioredis';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);
const redis = config.redisUrl ? new Redis(config.redisUrl, { maxRetriesPerRequest: 2 }) : null;

// A rate limiter that cannot reach Redis lets requests through, so a connection
// error here must not take the process down.
redis?.on('error', (error: Error) => {
  app.log.warn({ err: error }, 'redis unavailable, capture continues unlimited');
});

const app = buildApp(db, config.databaseUrl, redis);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  redis?.disconnect();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
