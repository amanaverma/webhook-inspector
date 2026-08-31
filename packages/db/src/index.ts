import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

/**
 * Opens a connection pool and returns a Drizzle client bound to the schema.
 *
 * The pool is not closed for you. A long-lived process should keep one client
 * for its lifetime rather than calling this per request.
 */
export function createDb(url: string) {
  return drizzle(postgres(url), { schema });
}

export type Db = ReturnType<typeof createDb>;

export * from './schema.js';
