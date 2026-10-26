import { Place } from '@rowing/core';
import { z } from 'zod';
import type { SourceResult } from '../adapters/http.ts';
import { normalizeQuery } from '../adapters/nominatim/nominatim.ts';
import type { Geocoder } from '../adapters/types.ts';
import { cacheTtlMs, type SourceCache } from './sourceCache.ts';

const Places = z.array(Place);

export type SearchPlaces = (query: string) => Promise<SourceResult<Place[]>>;

// Place search through the cache. Nominatim's policy asks clients to cache, and repeated
// identical queries can get a client blocked, so results are kept for weeks: places don't move.
// A stale result is better than none when the geocoder fails.
export function createPlaceSearch(deps: { geocoder: Geocoder; cache: SourceCache }): SearchPlaces {
  return async (query) => {
    const normalized = normalizeQuery(query);
    const result = await deps.cache.get(
      `nominatim:search:${normalized}`,
      cacheTtlMs.placeSearch,
      Places,
      () => deps.geocoder.search(normalized),
    );
    return result.status === 'error'
      ? { ok: false, error: result.error }
      : { ok: true, data: result.data };
  };
}
