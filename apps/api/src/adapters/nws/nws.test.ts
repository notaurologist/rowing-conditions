import { Alert, ForecastPoint, toSI } from '@rowing/core';
import { describe, expect, it, vi } from 'vitest';
import { fixture, json, loadFixture, type Route, routedFetch } from '../../../test/fixtures.ts';
import type { FetchFn, Logger } from '../http.ts';
import { createNwsAdapter } from './nws.ts';

const LAT = 42.6;
const LON = -72.55;
const NOW = new Date('2026-10-26T00:10:00Z'); // KORE's fixture observation is from 23:52Z
const UA = 'rowing-conditions-test (test@example.test)';

// Raw fixture JSON, edited per test.
interface Series {
  uom: string;
  values: { validTime: string; value: number | null }[];
}
const grid = () =>
  loadFixture('nws/grid-box-20-103').body as { properties: Record<string, Series> };
function series(body: { properties: Record<string, Series> }, name: string): Series {
  const s = body.properties[name];
  if (s === undefined) throw new Error(`fixture has no ${name}`);
  return s;
}

const routes = (overrides: Route[] = []): Route[] => [
  ...overrides,
  { path: '/points/42.6,-72.55', respond: fixture('nws/points-turners-falls') },
  { path: '/gridpoints/BOX/20,103', respond: fixture('nws/grid-box-20-103') },
  { path: '/gridpoints/BOX/20,103/stations', respond: fixture('nws/stations-box-20-103') },
  { path: '/stations/KORE/observations/latest', respond: fixture('nws/observation-kore') },
  { path: '/alerts/active', respond: fixture('nws/alerts-turners-falls') },
];

function adapter(r: Route[] = routes(), now = NOW) {
  const fetch = routedFetch(r);
  const logger: Logger = { warn: vi.fn() };
  const nws = createNwsAdapter({ userAgent: UA, fetch, logger, now: () => now, retryDelayMs: 0 });
  return { nws, fetch, logger };
}

async function forecast(r?: Route[], hours = 48) {
  const result = await adapter(r).nws.getHourlyForecast(LAT, LON, hours);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

const hourAt = (points: ForecastPoint[], time: string) => points.find((p) => p.time === time);

describe('getPoint', () => {
  it('returns the grid, time zone, and nearest place', async () => {
    expect(await adapter().nws.getPoint(LAT, LON)).toEqual({
      ok: true,
      data: {
        gridId: 'BOX',
        gridX: 20,
        gridY: 103,
        timeZone: 'America/New_York',
        place: 'Turners Falls, MA',
      },
    });
  });
});

describe('getHourlyForecast', () => {
  it('returns 48 consecutive hours from the current hour, each a valid ForecastPoint', async () => {
    const points = await forecast();
    expect(points).toHaveLength(48);
    expect(points[0]?.time).toBe('2026-10-26T00:00:00.000Z');
    expect(points[47]?.time).toBe('2026-10-27T23:00:00.000Z');
    for (const p of points) expect(ForecastPoint.safeParse(p).success).toBe(true);
  });

  it('converts each series from its WMO unit to SI', async () => {
    const h = hourAt(await forecast(), '2026-10-26T00:00:00.000Z');
    expect(h?.values.airTemp).toBeCloseTo(7.222222222222222, 9); // already °C
    expect(h?.values.windSpeed).toBeCloseTo(toSI(3.704, 'km/h'), 9);
    expect(h?.values.windGust).toBeCloseTo(toSI(9.26, 'km/h'), 9);
    expect(h?.values.windDirection).toBe(210);
    expect(h?.values.precipChance).toBe(0);
  });

  it('expands multi-hour intervals: a PT3H wind value fills three hours, a P2DT22H rain value 70', async () => {
    const points = await forecast(undefined, 48);
    const wind = (t: string) => hourAt(points, t)?.values.windSpeed;
    expect(wind('2026-10-26T01:00:00.000Z')).toBe(wind('2026-10-26T00:00:00.000Z'));
    expect(wind('2026-10-26T02:00:00.000Z')).toBe(wind('2026-10-26T00:00:00.000Z'));
    expect(hourAt(points, '2026-10-27T12:00:00.000Z')?.values.windGust).toBeCloseTo(
      toSI(18.52, 'km/h'),
      9,
    );
  });

  it('carries the forecast update time and grid in provenance', async () => {
    const h = (await forecast())[0];
    expect(h?.provenance.windSpeed).toEqual({
      kind: 'forecast',
      asOf: '2026-10-25T19:30:42.000Z',
      source: 'nws',
      sourceRef: 'BOX/20,103',
    });
  });

  it('turns rain chance into a fraction', async () => {
    const body = grid();
    series(body, 'probabilityOfPrecipitation').values = [
      { validTime: '2026-10-26T00:00:00+00:00/P2D', value: 40 },
    ];
    const points = await forecast(
      routes([{ path: '/gridpoints/BOX/20,103', respond: json(body) }]),
    );
    expect(points[0]?.values.precipChance).toBe(0.4);
  });

  it('marks hours with no gust value as missing (null), not zero, keeping the source', async () => {
    // Derived from the recorded grid: gust values removed from 00:00 to 06:00 on October 26.
    const body = grid();
    series(body, 'windGust').values = series(body, 'windGust').values.filter(
      (v: { validTime: string }) => {
        const start = Date.parse(v.validTime.split('/')[0] ?? '');
        return (
          start < Date.parse('2026-10-25T22:00:00Z') || start >= Date.parse('2026-10-26T06:00:00Z')
        );
      },
    );
    series(body, 'windGust').values.push({
      validTime: '2026-10-26T04:00:00+00:00/PT1H',
      value: null,
    });
    const points = await forecast(
      routes([{ path: '/gridpoints/BOX/20,103', respond: json(body) }]),
    );
    const gust = hourAt(points, '2026-10-26T01:00:00.000Z');
    expect(gust?.values.windGust).toBeNull();
    expect(gust?.provenance.windGust?.source).toBe('nws');
    expect(hourAt(points, '2026-10-26T04:00:00.000Z')?.values.windGust).toBeNull();
    expect(hourAt(points, '2026-10-26T07:00:00.000Z')?.values.windGust).not.toBeNull();
  });

  it('skips and logs a series in a unit it does not know, rather than guessing', async () => {
    const body = grid();
    series(body, 'windSpeed').uom = 'wmoUnit:kn';
    const r = adapter(routes([{ path: '/gridpoints/BOX/20,103', respond: json(body) }]));
    const result = await r.nws.getHourlyForecast(LAT, LON, 2);
    expect(result.ok && result.data[0]?.values.windSpeed).toBeUndefined();
    expect(r.logger.warn).toHaveBeenCalledWith(
      'nws: unknown unit, series skipped',
      expect.anything(),
    );
  });
});

describe('requests', () => {
  it('sends the configured User-Agent on every request', async () => {
    const r = adapter();
    const calls: RequestInit[] = [];
    const recording: FetchFn = async (url, init) => {
      calls.push(init ?? {});
      return r.fetch(url, init);
    };
    const nws = createNwsAdapter({ userAgent: UA, fetch: recording, logger: { warn: vi.fn() } });
    await nws.getPoint(LAT, LON);
    const headers = calls[0]?.headers as Record<string, string> | undefined;
    expect(headers?.['User-Agent']).toBe(UA);
  });

  // Node's fetch sends Accept-Language: * by default, and the NWS CDN served a stale copy for it (#87).
  it('sends an explicit Accept-Language on every request', async () => {
    const r = adapter();
    const calls: RequestInit[] = [];
    const recording: FetchFn = async (url, init) => {
      calls.push(init ?? {});
      return r.fetch(url, init);
    };
    const nws = createNwsAdapter({
      userAgent: UA,
      fetch: recording,
      logger: { warn: vi.fn() },
      now: () => NOW,
    });
    await nws.getHourlyForecast(LAT, LON, 48);
    await nws.getCurrent(LAT, LON);
    await nws.getAlerts(LAT, LON);
    expect(calls.length).toBeGreaterThan(4);
    for (const call of calls) {
      expect((call.headers as Record<string, string>)['Accept-Language']).toBe('en-US');
    }
  });

  it('rounds coordinates to 4 decimals, which the API requires', async () => {
    const r = adapter();
    await r.nws.getPoint(42.600001, -72.550004);
    expect(r.fetch.calls[0]).toBe('https://api.weather.gov/points/42.6,-72.55');
  });

  it('retries a 5xx once, then succeeds', async () => {
    let attempts = 0;
    const flaky: Route = {
      path: '/points/42.6,-72.55',
      respond: () => {
        attempts += 1;
        return attempts === 1 ? json({}, 503)() : fixture('nws/points-turners-falls')();
      },
    };
    const result = await adapter(routes([flaky])).nws.getPoint(LAT, LON);
    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
  });

  it('gives up after one retry, and never retries a 4xx', async () => {
    const r500 = adapter(routes([{ path: '/points/42.6,-72.55', respond: json({}, 500) }]));
    expect(await r500.nws.getPoint(LAT, LON)).toMatchObject({ ok: false, error: { status: 500 } });
    expect(r500.fetch.calls).toHaveLength(2);
    const r404 = adapter(routes([{ path: '/points/42.6,-72.55', respond: json({}, 404) }]));
    await r404.nws.getPoint(LAT, LON);
    expect(r404.fetch.calls).toHaveLength(1);
  });
});

describe('getCurrent', () => {
  it('uses the nearest fresh station within 30 km, with its name and distance', async () => {
    const result = await adapter().nws.getCurrent(LAT, LON);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.basis).toBe('station');
    expect(result.data.station).toMatchObject({ id: 'KORE', name: 'Orange Municipal Airport' });
    expect(result.data.station?.distanceKm).toBeCloseTo(21.8, 0);
    const byMetric = Object.fromEntries(result.data.readings.map((r) => [r.metric, r.value]));
    // The recorded observation had no temperature (QC "Z") and no gust: both missing, not zero.
    expect(byMetric).toEqual({ airTemp: null, windSpeed: 0, windGust: null, windDirection: 0 });
    expect(result.data.readings[0]).toMatchObject({
      observedAt: '2026-10-25T23:52:00.000Z',
      source: 'nws',
      sourceRef: 'KORE',
    });
  });

  it('falls back to the forecast for the current hour when the observation is too old', async () => {
    const later = new Date('2026-10-26T02:30:00Z'); // the observation is now 2h38m old
    const result = await adapter(routes(), later).nws.getCurrent(LAT, LON);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.basis).toBe('forecast');
    expect(result.data.station).toBeUndefined();
    const wind = result.data.readings.find((r) => r.metric === 'windSpeed');
    expect(wind).toMatchObject({ observedAt: '2026-10-26T02:00:00.000Z', sourceRef: 'BOX/20,103' });
  });

  it('falls back to the forecast when no station is within 30 km', async () => {
    const far = {
      features: [
        {
          geometry: { coordinates: [-71.0, 42.6] },
          properties: { stationIdentifier: 'KFAR', name: 'Far Away' },
        },
      ],
    };
    const r = adapter(routes([{ path: '/gridpoints/BOX/20,103/stations', respond: json(far) }]));
    const result = await r.nws.getCurrent(LAT, LON);
    expect(result.ok && result.data.basis).toBe('forecast');
    expect(r.fetch.calls.some((u) => u.includes('/stations/KFAR'))).toBe(false);
  });

  it('marks values NWS quality control rejected or questioned as unreliable', async () => {
    const obs = loadFixture('nws/observation-kore').body as { properties: Record<string, unknown> };
    obs.properties.windSpeed = { unitCode: 'wmoUnit:km_h-1', value: 20, qualityControl: 'X' };
    obs.properties.windGust = { unitCode: 'wmoUnit:km_h-1', value: 30, qualityControl: 'Q' };
    const r = adapter(routes([{ path: '/stations/KORE/observations/latest', respond: json(obs) }]));
    const result = await r.nws.getCurrent(LAT, LON);
    const q = (metric: string) =>
      result.ok ? result.data.readings.find((x) => x.metric === metric)?.qualifiers : undefined;
    expect(q('windSpeed')).toEqual(['unreliable']);
    expect(q('windGust')).toEqual(['unreliable']);
    expect(q('windDirection')).toBeUndefined();
  });
});

describe('getAlerts', () => {
  it('returns no alerts where there are none', async () => {
    expect(await adapter().nws.getAlerts(LAT, LON)).toEqual({ ok: true, data: [] });
  });

  it('normalizes alert times to UTC', async () => {
    const r = adapter(
      routes([{ path: '/alerts/active', respond: fixture('nws/alerts-sample-ak') }]),
    );
    const result = await r.nws.getAlerts(LAT, LON);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data).toHaveLength(3);
    for (const a of result.data) expect(Alert.safeParse(a).success).toBe(true);
    expect(result.data[0]).toMatchObject({
      event: 'Winter Weather Advisory',
      severity: 'Moderate',
      onset: '2026-10-25T23:49:00.000Z', // 15:49 AKDT
      ends: '2026-10-26T06:00:00.000Z',
    });
  });

  it('uses the expiry when an alert has no end, and maps an unknown severity to Unknown', async () => {
    const body = {
      features: [
        {
          properties: {
            id: 'a1',
            event: 'Special Weather Statement',
            headline: null,
            severity: 'Weird',
            onset: null,
            ends: null,
            expires: '2026-10-26T01:00:00-04:00',
          },
        },
      ],
    };
    const r = adapter(routes([{ path: '/alerts/active', respond: json(body) }]));
    expect(await r.nws.getAlerts(LAT, LON)).toEqual({
      ok: true,
      data: [
        {
          id: 'a1',
          event: 'Special Weather Statement',
          headline: null,
          severity: 'Unknown',
          onset: null,
          ends: '2026-10-26T05:00:00.000Z',
        },
      ],
    });
  });
});
