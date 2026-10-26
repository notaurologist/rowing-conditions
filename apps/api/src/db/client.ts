import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

// Any Drizzle Postgres database with our schema: postgres.js in the app, PGlite in tests.
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDatabase(url: string): { db: Database; close: () => Promise<void> } {
  const client = postgres(url);
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
