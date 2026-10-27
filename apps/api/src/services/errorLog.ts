import { lt, sql } from 'drizzle-orm';
import { describeError, type Logger } from '../adapters/http.ts';
import { DATABASE_TIMEOUT_MS, type Database, withTimeout } from '../db/client.ts';
import { errorEvents } from '../db/schema.ts';

export const ERROR_RETENTION_DAYS = 30;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export interface ErrorEvent {
  level: 'warn' | 'error';
  message: string; // a fixed message, never one built from request data
  details?: Record<string, unknown>;
  route?: string;
}

export interface ErrorLog {
  // Writes to the console and records the event in error_events.
  record(event: ErrorEvent): void;
  // Resolves when every recorded event has been written or has failed. The app calls it before
  // each response, so a function instance isn't frozen with writes still pending.
  flush(): Promise<void>;
  // The adapters' logger, recording through this log.
  logger: Logger;
}

export interface ErrorLogOptions {
  db: Database;
  output?: Pick<Console, 'warn' | 'error'>;
  now?: () => number; // milliseconds, for deciding when to prune
  timeoutMs?: number; // per write, so flush() never waits on a database that has stopped answering
}

// API warnings and errors kept in Postgres for 30 days (decision 0018). Vercel keeps runtime logs
// for an hour, so the console alone is gone before anyone looks. A failed write goes to the
// console only and never fails the request.
export function createErrorLog(options: ErrorLogOptions): ErrorLog {
  const { db } = options;
  const output = options.output ?? console;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DATABASE_TIMEOUT_MS;
  const pending = new Set<Promise<void>>();
  let lastPrune = Number.NEGATIVE_INFINITY;

  const track = (write: PromiseLike<unknown>, what: string) => {
    const done = withTimeout(write, timeoutMs).then(
      () => {},
      (error: unknown) => {
        output.warn(`error log: ${what} failed`, { error: describeError(error) });
      },
    );
    pending.add(done);
    void done.finally(() => pending.delete(done));
  };

  const record = (event: ErrorEvent) => {
    output[event.level](event.message, event.details ?? '');
    track(
      db.insert(errorEvents).values({
        level: event.level,
        message: event.message,
        details: event.details ?? null,
        route: event.route ?? null,
      }),
      'write',
    );
    // Old rows go as part of recording new ones, so no scheduled job is needed (decision 0006).
    if (now() - lastPrune >= PRUNE_INTERVAL_MS) {
      lastPrune = now();
      track(
        db
          .delete(errorEvents)
          .where(
            lt(
              errorEvents.occurredAt,
              sql`now() - (${ERROR_RETENTION_DAYS}::int * interval '1 day')`,
            ),
          ),
        'pruning',
      );
    }
  };

  return {
    record,
    async flush() {
      while (pending.size > 0) await Promise.all(pending);
    },
    logger: { warn: (message, details) => record({ level: 'warn', message, details }) },
  };
}
