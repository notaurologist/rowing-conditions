import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

// Any Drizzle Postgres database with our schema: postgres.js in the app, PGlite in tests.
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

// The postgres.js settings the app changes. Defaults suit a local server.
export type ConnectionOptions = Pick<
  postgres.Options<Record<string, never>>,
  'prepare' | 'max' | 'idle_timeout' | 'connect_timeout'
>;

export function createDatabase(
  url: string,
  options: ConnectionOptions = {},
): { db: Database; close: () => Promise<void> } {
  const client = postgres(url, options);
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

// How long the API waits for any one database call. postgres.js bounds connecting but not a query
// on an open connection, so a database that stops answering would otherwise hold the request
// forever (#122). Every database call is optional to a response, so the API carries on without it.
export const DATABASE_TIMEOUT_MS = 5_000;

export class DatabaseTimeoutError extends Error {
  constructor(ms: number) {
    super(`database did not answer within ${ms} ms`);
    this.name = 'DatabaseTimeoutError';
  }
}

// Rejects with DatabaseTimeoutError if the query hasn't settled within ms. The query itself isn't
// cancelled; it settles, unobserved, whenever the database answers.
export function withTimeout<T>(query: PromiseLike<T>, ms = DATABASE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DatabaseTimeoutError(ms)), ms);
  });
  return Promise.race([Promise.resolve(query), timeout]).finally(() => clearTimeout(timer));
}
