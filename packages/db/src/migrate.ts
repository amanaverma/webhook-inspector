import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Applies every migration in `packages/db/migrations` not yet recorded in the
 * database named by DATABASE_URL, then exits.
 *
 * Exits with code 1 when DATABASE_URL is unset or a migration fails. A failed
 * migration rolls back on its own, but migrations applied before it stay.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: new URL('../migrations', import.meta.url).pathname });
  console.log('migrations applied');
} catch (error) {
  console.error('migration failed', error);
  process.exitCode = 1;
} finally {
  await client.end();
}
