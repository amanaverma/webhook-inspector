import { createDb } from '@wi/db';
import { pruneSessions } from './auth/session.js';
import { loadConfig } from './config.js';
import { startWorker } from './delivery/worker.js';
import { pruneRequests } from './retention.js';

const HOUR_MS = 60 * 60 * 1000;

const config = loadConfig();
const db = createDb(config.databaseUrl);
const stop = startWorker(db);

/**
 * Removes expired sessions and requests past the retention window.
 *
 * Never rejects, since a failure here is worth logging but must not stop the
 * process delivering.
 */
async function prune(): Promise<void> {
  try {
    const [requests, sessions] = await Promise.all([
      pruneRequests(db, config.retentionDays),
      pruneSessions(db),
    ]);
    if (requests > 0 || sessions > 0) {
      console.log(`pruned ${requests} requests and ${sessions} sessions`);
    }
  } catch (error) {
    console.error('prune failed', error);
  }
}

void prune();
const pruneTimer = setInterval(() => void prune(), HOUR_MS);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(pruneTimer);
    void stop().then(() => process.exit(0));
  });
}

console.log('delivery worker started');
