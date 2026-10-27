import type { ConditionsResponse, Gauge, NearbyGauge, Reading } from '@rowing/core';
import { describe, expect, it, vi } from 'vitest';
import type { SourceResult } from './adapters/http.ts';
import type { FlowSource } from './adapters/types.ts';
import { createApp, DEFAULT_RADIUS_KM, MAX_FLOW_GAUGES, MAX_RADIUS_KM } from './app.ts';
import type { SnapCourse } from './services/courseSnap.ts';

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
  trends: [],
  flowSetAside: [],
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

describe('GET /course/snap (#103, #142)', () => {
  const path = '/course/snap?taps=42.335,-72.6203;42.3366,-72.6150;42.3444,-72.632;42.335,-72.6203';
  const snapApp = (snapCourse?: SnapCourse) =>
    createApp({
      usgs: fakeUsgs(),
      conditions: fakeConditions(),
      ...(snapCourse ? { snapCourse } : {}),
    });

  it('returns a leg between each pair of taps, straight ones saying why', async () => {
    const legs = [
      {
        points: [
          [42.335, -72.6203],
          [42.3366, -72.615],
        ] as [number, number][],
        straight: 'detour' as const,
      },
      {
        points: [
          [42.3366, -72.6177],
          [42.3444, -72.632],
        ] as [number, number][],
      },
      {
        points: [
          [42.3444, -72.632],
          [42.3353, -72.6192],
        ] as [number, number][],
      },
    ];
    const snapCourse = vi.fn<SnapCourse>(async () => ({ ok: true, legs }));
    const res = await snapApp(snapCourse).request(path);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ legs });
    expect(snapCourse).toHaveBeenCalledWith([
      [42.335, -72.6203],
      [42.3366, -72.615],
      [42.3444, -72.632],
      [42.335, -72.6203],
    ]);
  });

  it.each([
    ['tooFar', 'more than 30 km apart'],
    ['tooMany', 'at most 12 points'],
  ] as const)('explains %s in words, as 422', async (reason, words) => {
    const res = await snapApp(async () => ({ ok: false, reason })).request(path);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe(reason);
    expect(body.error.message).toContain(words);
  });

  it('reports a busy source as 502, in words', async () => {
    const error = { source: 'overpass' as const, kind: 'timeout' as const, message: 'timed out' };
    const res = await snapApp(async () => ({ ok: false, reason: 'sourceError', error })).request(
      path,
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: {
        source: 'overpass',
        kind: 'timeout',
        message: "OpenStreetMap's river data is busy right now. Try again in a few minutes.",
      },
    });
  });

  it.each([
    ['missing', '/course/snap'],
    ['one tap', '/course/snap?taps=42.6,-72.5'],
    ['not numbers', '/course/snap?taps=a,b;c,d'],
    ['out of range', '/course/snap?taps=95,-72.5;42.6,-72.5'],
    ['three numbers', '/course/snap?taps=42.6,-72.5,1;42.6,-72.5'],
  ])('rejects taps that are %s', async (_, badPath) => {
    const snapCourse = vi.fn<SnapCourse>();
    expect((await snapApp(snapCourse).request(badPath)).status).toBe(400);
    expect(snapCourse).not.toHaveBeenCalled();
  });
});

describe('errors', () => {
  const fakeErrorLog = () => {
    const events: unknown[] = [];
    let flushed = 0;
    return {
      events,
      flushed: () => flushed,
      record: vi.fn((event: unknown) => {
        events.push(event);
      }),
      flush: vi.fn(async () => {
        flushed += 1;
      }),
    };
  };

  it('records an unhandled exception with the route pattern and answers 500 without details', async () => {
    const errorLog = fakeErrorLog();
    const conditions = vi.fn(async () => {
      throw new TypeError('boom at 42.6,-72.55');
    });
    const res = await createApp({ usgs: fakeUsgs(), conditions, errorLog }).request(
      '/conditions?lat=42.6&lon=-72.55',
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { message: 'Something went wrong on the server.' } });
    expect(errorLog.events).toEqual([
      {
        level: 'error',
        message: 'unhandled exception',
        route: '/conditions',
        details: { name: 'TypeError', message: 'boom at 42.6,-72.55', stack: expect.any(String) },
      },
    ]);
    expect(errorLog.flushed()).toBe(1);
  });

  it('records nothing for a bad request, and still flushes', async () => {
    const errorLog = fakeErrorLog();
    const res = await createApp({
      usgs: fakeUsgs(),
      conditions: fakeConditions(),
      errorLog,
    }).request('/conditions?lat=north');
    expect(res.status).toBe(400);
    expect(errorLog.events).toEqual([]);
    expect(errorLog.flushed()).toBe(1);
  });

  it('waits for recorded events to be written before responding', async () => {
    let release: () => void = () => {};
    const written = new Promise<void>((resolve) => {
      release = resolve;
    });
    let responded = false;
    const errorLog = { record: vi.fn(), flush: vi.fn(() => written) };
    const app = createApp({ usgs: fakeUsgs(), conditions: fakeConditions(), errorLog });
    const pending = Promise.resolve(app.request('/health')).then(() => {
      responded = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(responded).toBe(false);
    release();
    await pending;
    expect(responded).toBe(true);
  });
});
