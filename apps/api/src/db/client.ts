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
