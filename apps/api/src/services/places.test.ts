import type { Place } from '@rowing/core';
import { describe, expect, it, vi } from 'vitest';
import type { SourceResult } from '../adapters/http.ts';
import { createPlaceSearch } from './places.ts';
import { cacheTtlMs, type SourceCache } from './sourceCache.ts';

const place: Place = {
  name: 'Turners Falls',
  displayName: 'Turners Falls, MA',
  lat: 42.6,
  lon: -72.55,
};

// A cache that records its keys and always calls through.
function passThroughCache() {
  const keys: { key: string; ttlMs: number }[] = [];
  const cache: SourceCache = {
    get: async (key, ttlMs, _schema, fetch) => {
      keys.push({ key, ttlMs });
      const result = await fetch();
      return result.ok
        ? { status: 'ok', data: result.data, fetchedAt: '2026-10-26T00:00:00.000Z', cached: false }
        : { status: 'error', error: result.error };
    },
  };
  return { cache, keys };
}

describe('createPlaceSearch', () => {
  it('caches by the normalized query and searches with it', async () => {
    const search = vi.fn(async (): Promise<SourceResult<Place[]>> => ({ ok: true, data: [place] }));
    const { cache, keys } = passThroughCache();
    const searchPlaces = createPlaceSearch({ geocoder: { search }, cache });

    expect(await searchPlaces('  Turners   FALLS ')).toEqual({ ok: true, data: [place] });
    expect(keys).toEqual([
      { key: 'nominatim:search:turners falls', ttlMs: cacheTtlMs.placeSearch },
    ]);
    expect(search).toHaveBeenCalledWith('turners falls');
  });

  it('serves a stale cached result when the geocoder fails', async () => {
    const cache: SourceCache = {
      get: async () =>
        ({
          status: 'stale',
          data: [place],
          fetchedAt: '2026-10-01T00:00:00.000Z',
          error: { source: 'nominatim', kind: 'timeout', message: 'timed out' },
        }) as never,
    };
    const searchPlaces = createPlaceSearch({ geocoder: { search: vi.fn() }, cache });
    expect(await searchPlaces('Turners Falls')).toEqual({ ok: true, data: [place] });
  });

  it('returns the error when nothing is cached', async () => {
    const error = {
      source: 'nominatim' as const,
      kind: 'http' as const,
      status: 403,
      message: 'HTTP 403',
    };
    const { cache } = passThroughCache();
    const searchPlaces = createPlaceSearch({
      geocoder: { search: async () => ({ ok: false, error }) },
      cache,
    });
    expect(await searchPlaces('x y')).toEqual({ ok: false, error });
  });
});
