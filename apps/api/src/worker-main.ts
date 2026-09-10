import { createDb } from '@wi/db';
import { loadConfig } from './config.js';
import { startWorker } from './delivery/worker.js';

const config = loadConfig();
const stop = startWorker(createDb(config.databaseUrl));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void stop().then(() => process.exit(0));
  });
}

console.log('delivery worker started');
