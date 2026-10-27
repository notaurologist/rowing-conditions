import { describe, expect, it, vi } from 'vitest';
import { fixture, json, routedFetch } from '../../../test/fixtures.ts';
import type { Logger } from '../http.ts';
import { createNominatimAdapter, normalizeQuery } from './nominatim.ts';

const UA = 'rowing-conditions-test (test@example.test)';

function adapter(
  respond = fixture('nominatim/search-turners-falls'),
  gate = vi.fn(async () => {}),
) {
  const fetch = routedFetch([{ path: '/search', respond }]);
  const logger: Logger = { warn: vi.fn() };
  const nominatim = createNominatimAdapter({ userAgent: UA, fetch, logger, gate });
  return { nominatim, fetch, logger, gate };
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
    const nominatim = createNominatimAdapter({ userAgent: UA, fetch, gate: async () => {} });
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
    // The failed fields only: the place itself is what the user searched for.
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'nominatim: dropped a result that failed validation',
      { fields: ['lat'] },
    );
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
  it('waits on the gate before every request', async () => {
    const order: string[] = [];
    const gate = vi.fn(async () => {
      order.push('gate');
    });
    const { nominatim, fetch } = adapter(fixture('nominatim/search-turners-falls'), gate);
    const fetchCalls = () => fetch.calls.length;
    await nominatim.search('a');
    order.push(`fetched ${fetchCalls()}`);
    await nominatim.search('b');
    order.push(`fetched ${fetchCalls()}`);
    expect(order).toEqual(['gate', 'fetched 1', 'gate', 'fetched 2']);
  });

  it('waits on the gate after a failed request too', async () => {
    const { nominatim, gate } = adapter(json({}, 500));
    await nominatim.search('a');
    await nominatim.search('b');
    expect(gate).toHaveBeenCalledTimes(2);
  });

  it('sends nothing and returns an error when the gate fails, and logs it', async () => {
    const gate = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const { nominatim, fetch, logger } = adapter(fixture('nominatim/search-turners-falls'), gate);
    expect(await nominatim.search('a')).toEqual({
      ok: false,
      error: { source: 'nominatim', kind: 'unavailable', message: 'Request gate unavailable' },
    });
    expect(fetch.calls).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      'nominatim: request gate unavailable, request not sent',
      { error: 'connection refused' },
    );
  });
});

describe('normalizeQuery', () => {
  it('trims, collapses spaces and lowercases, for cache keys', () => {
    expect(normalizeQuery('  Turners   Falls ')).toBe('turners falls');
  });
});
