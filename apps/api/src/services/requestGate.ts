import { sql } from 'drizzle-orm';
import { DATABASE_TIMEOUT_MS, type Database, withTimeout } from '../db/client.ts';
import { requestGates } from '../db/schema.ts';

// Resolves when the caller may start its request. Rejects if the gate can't be checked, and the
// caller must then not send the request.
export type RequestGate = () => Promise<void>;

export interface DatabaseGateOptions {
  db: Database;
  name: string; // the gate's row in request_gates, e.g. 'nominatim'
  minIntervalMs: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number; // for reserving a slot; past it, the gate rejects
}

// A gate shared by every API instance through Postgres (decision 0017): each request starts at
// least minIntervalMs after the previous one, whichever instance sent it. One statement reserves
// the next start time under the row's lock, so callers queue without holding a connection while
// they wait. Times come from the database's clock, so instances' clocks don't need to agree.
export function createDatabaseGate(options: DatabaseGateOptions): RequestGate {
  const { db, name, minIntervalMs } = options;
  const timeoutMs = options.timeoutMs ?? DATABASE_TIMEOUT_MS;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const interval = sql`(${minIntervalMs}::int * interval '1 millisecond')`;

  return async () => {
    const [row] = await withTimeout(
      db
        .insert(requestGates)
        .values({ name, lastStart: sql`now()` })
        .onConflictDoUpdate({
          target: requestGates.name,
          set: { lastStart: sql`greatest(${requestGates.lastStart} + ${interval}, now())` },
        })
        .returning({
          waitMs: sql<number>`greatest(0, extract(epoch from ${requestGates.lastStart} - now()) * 1000)::float8`,
        }),
      timeoutMs,
    );
    if (!row) throw new Error(`request gate ${name}: no slot reserved`);
    const waitMs = Number(row.waitMs);
    if (waitMs > 0) await sleep(waitMs);
  };
}
