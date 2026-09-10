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

/**
 * Opens a connection dedicated to LISTEN.
 *
 * Postgres holds a listening connection open for the life of the subscription,
 * so this must not share the pool the rest of the application queries through.
 * Close it with `client.end()`.
 */
export function createListenClient(url: string) {
  return postgres(url, { max: 1 });
}

export type ListenClient = ReturnType<typeof createListenClient>;

export * from './schema.js';
