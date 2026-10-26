import type { Gauge, NearbyGauge, Reading } from '@rowing/core';
import { describe, expect, it, vi } from 'vitest';
import type { SourceResult } from './adapters/http.ts';
import type { FlowSource } from './adapters/types.ts';
import { createApp, DEFAULT_RADIUS_KM, MAX_FLOW_GAUGES, MAX_RADIUS_KM } from './app.ts';
import type { ConditionsResponse } from './services/conditions.ts';

const montague: Gauge = {
  ref: 'usgs:USGS-01170500',
  source: 'usgs',
  name: 'CONNECTICUT RIVER AT MONTAGUE CITY, MA',
  lat: 42.58,
  lon: -72.57,
  metrics: ['flow', 'gaugeHeight'],
};
const nearby: NearbyGauge[] = [{ ...montague, distanceKm: 3.2 }];
const flow: Reading = {
  metric: 'flow',
  value: 143.28,
  observedAt: '2026-10-25T23:15:00.000Z',
  fetchedAt: '2026-10-25T23:30:00.000Z',
  source: 'usgs',
  sourceRef: 'USGS-01170500',
  qualifiers: ['provisional'],
};
const ok = <T>(data: T): SourceResult<T> => ({ ok: true, data });
const failed: SourceResult<never> = {
  ok: false,
  error: { source: 'usgs', kind: 'timeout', message: 'The operation timed out' },
};

function fakeUsgs(overrides: Partial<FlowSource> = {}): FlowSource {
  return {
    id: 'usgs',
    findNearby: vi.fn(async () => ok(nearby)),
    getGauge: vi.fn(async () => ok(montague)),
    getLatest: vi.fn(async () => ok([flow])),
    getHistory: vi.fn(async () => ok([])),
    ...overrides,
  };
}

const emptyConditions: ConditionsResponse = {
  location: { lat: 42.6, lon: -72.55, timezone: 'America/New_York' },
  current: [],
  forecast: [],
  flowSeries: [],
  daylight: [],
  alerts: [],
  sources: [{ id: 'nws', status: 'error', message: 'nws timed out' }],
};
const fakeConditions = () => vi.fn(async () => emptyConditions);

const request = (path: string, usgs = fakeUsgs(), conditions = fakeConditions()) =>
  createApp({ usgs, conditions }).request(path);

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('returns 404 for an unknown route', async () => {
    expect((await request('/nope')).status).toBe(404);
  });
});

describe('GET /gauges/nearby', () => {
  it('returns nearby gauges from the adapter', async () => {
    const usgs = fakeUsgs();
    const res = await request('/gauges/nearby?lat=42.6&lon=-72.55&radiusKm=15', usgs);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gauges: nearby });
    expect(usgs.findNearby).toHaveBeenCalledWith(42.6, -72.55, 15);
  });

  it('uses the default radius when none is given', async () => {
    const usgs = fakeUsgs();
    await request('/gauges/nearby?lat=42.6&lon=-72.55', usgs);
    expect(usgs.findNearby).toHaveBeenCalledWith(42.6, -72.55, DEFAULT_RADIUS_KM);
  });

  it.each([
    ['missing lat', '/gauges/nearby?lon=-72.55'],
    ['empty lat', '/gauges/nearby?lat=&lon=-72.55'],
    ['non-numeric lon', '/gauges/nearby?lat=42.6&lon=west'],
    ['lat out of range', '/gauges/nearby?lat=91&lon=-72.55'],
    ['lon out of range', '/gauges/nearby?lat=42.6&lon=-181'],
    ['radius too large', `/gauges/nearby?lat=42.6&lon=-72.55&radiusKm=${MAX_RADIUS_KM + 1}`],
    ['radius zero', '/gauges/nearby?lat=42.6&lon=-72.55&radiusKm=0'],
  ])('rejects %s with 400 and does not call the adapter', async (_, path) => {
    const usgs = fakeUsgs();
    expect((await request(path, usgs)).status).toBe(400);
    expect(usgs.findNearby).not.toHaveBeenCalled();
  });

  it('reports an upstream failure as 502 with the source and kind', async () => {
    const res = await request(
      '/gauges/nearby?lat=42.6&lon=-72.55',
      fakeUsgs({ findNearby: async () => failed }),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { source: 'usgs', kind: 'timeout', message: 'The operation timed out' },
    });
  });
});

describe('GET /gauges/:ref', () => {
  it('returns the gauge and its latest readings', async () => {
    const usgs = fakeUsgs();
    const res = await request('/gauges/usgs:USGS-01170500', usgs);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      gauge: montague,
      latest: [flow],
      sources: [{ id: 'usgs', status: 'ok' }],
    });
    expect(usgs.getGauge).toHaveBeenCalledWith('USGS-01170500');
  });

  it('accepts a URL-encoded ref', async () => {
    expect((await request('/gauges/usgs%3AUSGS-01170500')).status).toBe(200);
  });

  it('returns 404 for a gauge that does not exist', async () => {
    const res = await request(
      '/gauges/usgs:USGS-99999999',
      fakeUsgs({ getGauge: async () => ok(null) }),
    );
    expect(res.status).toBe(404);
  });

  it('rejects a ref without a known source prefix', async () => {
    expect((await request('/gauges/USGS-01170500')).status).toBe(400);
    expect((await request('/gauges/noaa:MNTM3')).status).toBe(400);
  });

  it('answers NWPS refs with 501 until that adapter exists', async () => {
    expect((await request('/gauges/nwps:MNTM3')).status).toBe(501);
  });

  it('returns 502 when the gauge lookup fails', async () => {
    const res = await request(
      '/gauges/usgs:USGS-01170500',
      fakeUsgs({ getGauge: async () => failed }),
    );
    expect(res.status).toBe(502);
  });

  it('still returns the gauge when only the readings fail, and says so', async () => {
    const res = await request(
      '/gauges/usgs:USGS-01170500',
      fakeUsgs({ getLatest: async () => failed }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      gauge: montague,
      latest: [],
      sources: [{ id: 'usgs', status: 'error', message: 'The operation timed out' }],
    });
  });
});

describe('GET /conditions', () => {
  it('passes validated input to the conditions service and returns its response with 200', async () => {
    const conditions = fakeConditions();
    const res = await request(
      '/conditions?lat=42.6&lon=-72.55&gaugeRef=usgs:USGS-01170500&flowGaugeRefs=nwps:MNTM3,usgs:USGS-01161280',
      fakeUsgs(),
      conditions,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(emptyConditions);
    expect(conditions).toHaveBeenCalledWith({
      lat: 42.6,
      lon: -72.55,
      gaugeRef: 'usgs:USGS-01170500',
      flowGaugeRefs: ['nwps:MNTM3', 'usgs:USGS-01161280'],
    });
  });

  it('returns 200 even when sources failed, since failures are reported per source', async () => {
    const res = await request('/conditions?lat=42.6&lon=-72.55');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConditionsResponse;
    expect(body.sources[0]?.status).toBe('error');
  });

  it('accepts a weather-only location and drops duplicate or empty flow gauge refs', async () => {
    const conditions = fakeConditions();
    await request(
      '/conditions?lat=42.6&lon=-72.55&flowGaugeRefs=nwps:MNTM3,,nwps:MNTM3',
      fakeUsgs(),
      conditions,
    );
    expect(conditions).toHaveBeenCalledWith({
      lat: 42.6,
      lon: -72.55,
      flowGaugeRefs: ['nwps:MNTM3'],
    });
  });

  it.each([
    ['missing lon', '/conditions?lat=42.6'],
    ['a bad gauge ref', '/conditions?lat=42.6&lon=-72.55&gaugeRef=01170500'],
    ['a bad flow gauge ref', '/conditions?lat=42.6&lon=-72.55&flowGaugeRefs=nwps:MNTM3,MNTM3'],
    [
      'too many flow gauges',
      `/conditions?lat=42.6&lon=-72.55&flowGaugeRefs=${Array.from({ length: MAX_FLOW_GAUGES + 1 }, (_, i) => `nwps:G${i}`).join(',')}`,
    ],
  ])('rejects %s with 400 without calling the service', async (_, path) => {
    const conditions = fakeConditions();
    expect((await request(path, fakeUsgs(), conditions)).status).toBe(400);
    expect(conditions).not.toHaveBeenCalled();
  });
});

describe('GET /places/search', () => {
  const place = { name: 'Turners Falls', displayName: 'Turners Falls, MA', lat: 42.6, lon: -72.55 };
  const searchApp = (searchPlaces?: (q: string) => Promise<SourceResult<(typeof place)[]>>) =>
    createApp({
      usgs: fakeUsgs(),
      conditions: fakeConditions(),
      ...(searchPlaces ? { searchPlaces } : {}),
    });

  it('returns matching places', async () => {
    const searchPlaces = vi.fn(async () => ok([place]));
    const res = await searchApp(searchPlaces).request('/places/search?q=Turners%20Falls');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ places: [place] });
    expect(searchPlaces).toHaveBeenCalledWith('Turners Falls');
  });

  it.each([
    ['missing', '/places/search'],
    ['blank', '/places/search?q=%20%20'],
    ['one character', '/places/search?q=a'],
    ['too long', `/places/search?q=${'a'.repeat(201)}`],
  ])('rejects a query that is %s', async (_, path) => {
    const searchPlaces = vi.fn(async () => ok([place]));
    const res = await searchApp(searchPlaces).request(path);
    expect(res.status).toBe(400);
    expect(searchPlaces).not.toHaveBeenCalled();
  });

  it('answers 503 when place search is turned off', async () => {
    const res = await searchApp().request('/places/search?q=Turners');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { message: 'Place search is turned off. Pick the location on the map.' },
    });
  });

  it('answers 502 when the geocoder fails', async () => {
    const res = await searchApp(async () => ({
      ok: false,
      error: { source: 'nominatim', kind: 'timeout', message: 'timed out' },
    })).request('/places/search?q=Turners');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { source: 'nominatim', kind: 'timeout', message: 'timed out' },
    });
  });
});
