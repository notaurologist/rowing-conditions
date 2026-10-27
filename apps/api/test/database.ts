import { type AddressInfo, createServer, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
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

// A postgres.js database whose server accepts connections and never answers, like a database that
// has frozen or a connection that has gone silent (#122). Every query waits until it's abandoned.
export async function createUnresponsiveDatabase(): Promise<{
  db: Database;
  close: () => Promise<void>;
}> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const client = postgres(`postgres://test:test@127.0.0.1:${port}/test`, {
    connect_timeout: 3600, // longer than any test, so only the API's own limit can end a query
  });
  return {
    db: drizzlePostgres(client, { schema }),
    close: async () => {
      await client.end({ timeout: 0 }); // abandons the queries still waiting
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
