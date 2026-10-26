import { Place } from '@rowing/core';
import { consoleLogger, type FetchFn, fetchJson, type Logger, type SourceResult } from '../http.ts';
import type { Geocoder } from '../types.ts';
import { NOMINATIM_MIN_INTERVAL_MS, searchUrl } from './requests.ts';
import { NominatimSearch } from './schemas.ts';

export interface NominatimAdapterOptions {
  userAgent: string; // the policy requires a User-Agent that identifies the app
  fetch?: FetchFn;
  timeoutMs?: number;
  logger?: Logger;
  minIntervalMs?: number;
  now?: () => number; // milliseconds, for the gate
  sleep?: (ms: number) => Promise<void>;
}

/** The form of a query used for cache keys: trimmed, single-spaced, lowercase. */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Nominatim's usage policy allows at most one request per second for the whole app, from a
// single thread. Requests go through this gate one at a time, each starting at least
// minIntervalMs after the previous one started. The gate is per process; the API runs as one.
function createGate(
  minIntervalMs: number,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
) {
  let lastStart = Number.NEGATIVE_INFINITY;
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const wait = lastStart + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
      return task();
    });
    queue = run.catch(() => {});
    return run;
  };
}

export function createNominatimAdapter(options: NominatimAdapterOptions): Geocoder {
  const logger = options.logger ?? consoleLogger;
  const gate = createGate(
    options.minIntervalMs ?? NOMINATIM_MIN_INTERVAL_MS,
    options.now ?? Date.now,
    options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  );
  const request = {
    source: 'nominatim' as const,
    fetch: options.fetch ?? globalThis.fetch,
    logger,
    headers: { 'User-Agent': options.userAgent },
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };

  return {
    async search(query: string): Promise<SourceResult<Place[]>> {
      const result = await gate(() => fetchJson(searchUrl(query.trim()), NominatimSearch, request));
      if (!result.ok) return result;

      const places: Place[] = [];
      for (const raw of result.data) {
        const place = Place.safeParse({
          name: raw.name || raw.display_name,
          displayName: raw.display_name,
          lat: Number(raw.lat),
          lon: Number(raw.lon),
        });
        if (place.success) places.push(place.data);
        else
          logger.warn('nominatim: dropped a result that failed validation', {
            placeId: raw.place_id,
          });
      }
      return { ok: true, data: places };
    },
  };
}
