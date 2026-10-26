import { describe, expect, it, vi } from 'vitest';
import { fixture, json, routedFetch } from '../../../test/fixtures.ts';
import type { Logger } from '../http.ts';
import { createNominatimAdapter, normalizeQuery } from './nominatim.ts';

const UA = 'rowing-conditions-test (test@example.test)';

function adapter(respond = fixture('nominatim/search-turners-falls')) {
  const fetch = routedFetch([{ path: '/search', respond }]);
  const logger: Logger = { warn: vi.fn() };
  const waits: number[] = [];
  let clock = 0;
  const nominatim = createNominatimAdapter({
    userAgent: UA,
    fetch,
    logger,
    minIntervalMs: 1000,
    now: () => clock,
    // A fake pause that advances the fake clock, so the gate can be checked without waiting.
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  return { nominatim, fetch, logger, waits, tick: (ms: number) => (clock += ms) };
}

describe('search', () => {
  it('returns places with numeric coordinates', async () => {
    const { nominatim } = adapter();
    expect(await nominatim.search('Turners Falls')).toEqual({
      ok: true,
      data: [
        {
          name: 'Turners Falls',
          displayName:
            'Turners Falls, Montague, Franklin County, Massachusetts, 01376, United States',
          lat: 42.6083091,
          lon: -72.5567883,
        },
      ],
    });
  });

  it('asks for US results in JSON, limited to a few', async () => {
    const { nominatim, fetch } = adapter();
    await nominatim.search('Turners Falls');
    const url = new URL(fetch.calls[0] ?? '');
    expect(url.origin).toBe('https://nominatim.openstreetmap.org');
    expect(url.searchParams.get('q')).toBe('Turners Falls');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('countrycodes')).toBe('us');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('sends the identifying User-Agent the usage policy requires', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json([])());
    const nominatim = createNominatimAdapter({ userAgent: UA, fetch, sleep: async () => {} });
    await nominatim.search('Turners Falls');
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('User-Agent')).toBe(UA);
  });

  it('returns an empty list when nothing matches', async () => {
    const { nominatim } = adapter(fixture('nominatim/search-no-results'));
    expect(await nominatim.search('qqzzxx no such place')).toEqual({ ok: true, data: [] });
  });

  it('uses the display name when a place has no name', async () => {
    const { nominatim } = adapter(
      json([{ place_id: 1, lat: '42.5', lon: '-72.4', name: '', display_name: 'Somewhere, MA' }]),
    );
    const result = await nominatim.search('somewhere');
    expect(result.ok && result.data[0]?.name).toBe('Somewhere, MA');
  });

  it('drops a result with coordinates out of range, and logs it', async () => {
    const { nominatim, logger } = adapter(
      json([
        { place_id: 1, lat: '142.5', lon: '-72.4', name: 'Bad', display_name: 'Bad' },
        { place_id: 2, lat: '42.5', lon: '-72.4', name: 'Good', display_name: 'Good, MA' },
      ]),
    );
    const result = await nominatim.search('x');
    expect(result.ok && result.data.map((p) => p.name)).toEqual(['Good']);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('reports a schema mismatch as a parse error', async () => {
    const { nominatim } = adapter(json({ error: 'nope' }));
    const result = await nominatim.search('x');
    expect(result).toMatchObject({ ok: false, error: { source: 'nominatim', kind: 'parse' } });
  });

  it('reports an HTTP failure, such as being blocked', async () => {
    const { nominatim } = adapter(json({}, 403));
    const result = await nominatim.search('x');
    expect(result).toMatchObject({
      ok: false,
      error: { source: 'nominatim', kind: 'http', status: 403 },
    });
  });
});

describe('the one-request-per-second gate', () => {
  it('spaces back-to-back requests by the minimum interval', async () => {
    const { nominatim, waits } = adapter();
    await Promise.all([nominatim.search('a'), nominatim.search('b'), nominatim.search('c')]);
    expect(waits).toEqual([1000, 1000]);
  });

  it('does not wait when the last request was long enough ago', async () => {
    const { nominatim, waits, tick } = adapter();
    await nominatim.search('a');
    tick(1500);
    await nominatim.search('b');
    expect(waits).toEqual([]);
  });

  it('waits only for the rest of the interval', async () => {
    const { nominatim, waits, tick } = adapter();
    await nominatim.search('a');
    tick(300);
    await nominatim.search('b');
    expect(waits).toEqual([700]);
  });

  it('keeps spacing requests after one fails', async () => {
    const { nominatim, waits } = adapter(json({}, 500));
    await Promise.all([nominatim.search('a'), nominatim.search('b')]);
    expect(waits).toEqual([1000]);
  });
});

describe('normalizeQuery', () => {
  it('trims, collapses spaces and lowercases, for cache keys', () => {
    expect(normalizeQuery('  Turners   Falls ')).toBe('turners falls');
  });
});
