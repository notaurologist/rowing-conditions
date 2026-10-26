import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database } from '../src/db/client.ts';
import * as schema from '../src/db/schema.ts';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

// A fresh in-memory Postgres (PGlite, decision 0016) with the committed migrations applied.
export async function createTestDatabase(): Promise<{
  db: Database;
  client: PGlite;
  close: () => Promise<void>;
}> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db, client, close: () => client.close() };
}
