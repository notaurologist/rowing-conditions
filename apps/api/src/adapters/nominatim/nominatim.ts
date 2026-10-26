import { Place } from '@rowing/core';
import type { RequestGate } from '../../services/requestGate.ts';
import { consoleLogger, type FetchFn, fetchJson, type Logger, type SourceResult } from '../http.ts';
import type { Geocoder } from '../types.ts';
import { searchUrl } from './requests.ts';
import { NominatimSearch } from './schemas.ts';

export interface NominatimAdapterOptions {
  userAgent: string; // the policy requires a User-Agent that identifies the app
  fetch?: FetchFn;
  timeoutMs?: number;
  logger?: Logger;
  // Nominatim's usage policy allows at most one request per second for the whole app. Every
  // request waits on this gate first; in the app it is shared through Postgres (requestGate.ts).
  gate: RequestGate;
}

/** The form of a query used for cache keys: trimmed, single-spaced, lowercase. */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function createNominatimAdapter(options: NominatimAdapterOptions): Geocoder {
  const logger = options.logger ?? consoleLogger;
  const request = {
    source: 'nominatim' as const,
    fetch: options.fetch ?? globalThis.fetch,
    logger,
    headers: { 'User-Agent': options.userAgent },
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };

  return {
    async search(query: string): Promise<SourceResult<Place[]>> {
      try {
        await options.gate();
      } catch (error) {
        // Without the gate the app can't be sure it stays under the limit, so it doesn't ask.
        logger.warn('nominatim: request gate unavailable, request not sent', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          ok: false,
          error: { source: 'nominatim', kind: 'unavailable', message: 'Request gate unavailable' },
        };
      }
      const result = await fetchJson(searchUrl(query.trim()), NominatimSearch, request);
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
