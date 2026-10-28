import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  describeError,
  type Logger,
  type SourceError,
  type SourceResult,
} from '../adapters/http.ts';
import { DATABASE_TIMEOUT_MS, type Database, withTimeout } from '../db/client.ts';
import { sourceCache } from '../db/schema.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Starting values from ARCHITECTURE.md (Caching); tune later. nwsCurrent and usgsHistory follow
// the observation cadence of their sources.
export const cacheTtlMs = {
  usgsLatest: 10 * MINUTE,
  usgsHistory: 10 * MINUTE,
  nwpsStageFlow: 30 * MINUTE,
  nwsForecast: 30 * MINUTE,
  nwsCurrent: 10 * MINUTE,
  nwsAlerts: 5 * MINUTE,
  nwsPoint: 30 * DAY,
  gaugeMetadata: 7 * DAY,
  placeSearch: 30 * DAY,
} as const;

export type CachedResult<T> =
  | { status: 'ok'; data: T; fetchedAt: string; cached: boolean }
  | { status: 'stale'; data: T; fetchedAt: string; error: SourceError } // source failed; last result
  | { status: 'error'; error: SourceError }; // source failed and nothing is cached

export interface SourceCache {
  // Serves a fresh stored result, or fetches, stores, and returns a new one. If the fetch fails,
  // serves the last stored result marked stale. Concurrent calls for one key share one fetch.
  get<T>(
    key: string,
    ttlMs: number,
    schema: z.ZodType<T>,
    fetch: () => Promise<SourceResult<T>>,
  ): Promise<CachedResult<T>>;
}

// A key's source and kind, such as 'nws:point', for logging. The rest of a key can be a location
// (coordinates or place search text), which recorded warnings never hold.
export function keyKind(key: string): string {
  return key.split(':').slice(0, 2).join(':');
}

export interface SourceCacheOptions {
  db: Database;
  logger: Logger;
  now?: () => Date;
  timeoutMs?: number; // per database call; past it, the call counts as failed
}

export function createSourceCache({
  db,
  logger,
  now = () => new Date(),
  timeoutMs = DATABASE_TIMEOUT_MS,
}: SourceCacheOptions): SourceCache {
  const inFlight = new Map<string, Promise<CachedResult<unknown>>>();

  async function read<T>(key: string, schema: z.ZodType<T>) {
    try {
      const [row] = await withTimeout(
        db.select().from(sourceCache).where(eq(sourceCache.key, key)),
        timeoutMs,
      );
      if (row === undefined) return undefined;
      const parsed = schema.safeParse(row.payload);
      if (!parsed.success) {
        logger.warn('cache: stored payload did not match schema; refetching', {
          kind: keyKind(key),
        });
        return undefined;
      }
      return { data: parsed.data, fetchedAt: row.fetchedAt, expiresAt: row.expiresAt };
    } catch (error) {
      // The cache is an optimization: without it, fetch directly.
      logger.warn('cache: read failed', { kind: keyKind(key), error: describeError(error) });
      return undefined;
    }
  }

  async function write(key: string, payload: unknown, fetchedAt: Date, ttlMs: number) {
    const expiresAt = new Date(fetchedAt.getTime() + ttlMs);
    try {
      await withTimeout(
        db
          .insert(sourceCache)
          .values({ key, payload, fetchedAt, expiresAt })
          .onConflictDoUpdate({ target: sourceCache.key, set: { payload, fetchedAt, expiresAt } }),
        timeoutMs,
      );
    } catch (error) {
      logger.warn('cache: write failed', { kind: keyKind(key), error: describeError(error) });
    }
  }

  async function load<T>(
    key: string,
    ttlMs: number,
    schema: z.ZodType<T>,
    fetch: () => Promise<SourceResult<T>>,
  ): Promise<CachedResult<T>> {
    const stored = await read(key, schema);
    if (stored && stored.expiresAt.getTime() > now().getTime()) {
      return {
        status: 'ok',
        data: stored.data,
        fetchedAt: stored.fetchedAt.toISOString(),
        cached: true,
      };
    }

    const result = await fetch();
    if (result.ok) {
      const fetchedAt = now();
      await write(key, result.data, fetchedAt, ttlMs);
      return { status: 'ok', data: result.data, fetchedAt: fetchedAt.toISOString(), cached: false };
    }
    if (stored) {
      return {
        status: 'stale',
        data: stored.data,
        fetchedAt: stored.fetchedAt.toISOString(),
        error: result.error,
      };
    }
    return { status: 'error', error: result.error };
  }

  return {
    get(key, ttlMs, schema, fetch) {
      const pending = inFlight.get(key);
      if (pending) return pending as Promise<CachedResult<z.infer<typeof schema>>>;
      const promise = load(key, ttlMs, schema, fetch).finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },
  };
}
