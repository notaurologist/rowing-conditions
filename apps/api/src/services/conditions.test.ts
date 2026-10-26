import { evaluateTimeline, type ForecastPoint, type Gauge, type Reading, toSI } from '@rowing/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../test/database.ts';
import type { SourceError, SourceResult } from '../adapters/http.ts';
import type { FlowForecastSource, FlowSource, WeatherSource } from '../adapters/types.ts';
import {
  type ConditionsDeps,
  ConditionsResponse,
  FORECAST_HOURS,
  getConditions,
} from './conditions.ts';
import { createSourceCache } from './sourceCache.ts';

const LAT = 42.6;
const LON = -72.55;
const HOUR = 3_600_000;
const T0 = '2026-10-26T12:00:00.000Z';
const at = (h: number) => new Date(Date.parse(T0) + h * HOUR).toISOString();
const ok = <T>(data: T): SourceResult<T> => ({ ok: true, data });
const fail = (source: SourceError['source']): SourceResult<never> => ({
  ok: false,
  error: { source, kind: 'timeout', message: `${source} timed out` },
});

const montague: Gauge = {
  ref: 'usgs:USGS-01170500',
  source: 'usgs',
  name: 'CONNECTICUT RIVER AT MONTAGUE CITY, MA',
  lat: 42.58,
  lon: -72.57,
  metrics: ['flow', 'gaugeHeight'],
};
const mntm3: Gauge = {
  ref: 'nwps:MNTM3',
  source: 'nwps',
  name: 'Connecticut River at Montague',
  lat: 42.58,
  lon: -72.57,
  metrics: ['flow', 'gaugeHeight'],
  hasFlowForecast: true,
  linkedRef: 'usgs:USGS-01170500',
};
const usgsLatest: Reading[] = [
  {
    metric: 'flow',
    value: toSI(5060, 'cfs'),
    observedAt: '2026-10-26T11:45:00.000Z',
    fetchedAt: T0,
    source: 'usgs',
    sourceRef: 'USGS-01170500',
    qualifiers: ['provisional'],
  },
];
const weather = (hours: number): ForecastPoint[] =>
  Array.from({ length: hours }, (_, h) => ({
    time: at(h),
    values: { windSpeed: 3, airTemp: 10 },
    provenance: {
      windSpeed: { kind: 'forecast', asOf: '2026-10-26T10:00:00.000Z', source: 'nws' },
      airTemp: { kind: 'forecast', asOf: '2026-10-26T10:00:00.000Z', source: 'nws' },
    },
  }));
// NWPS forecast for the first 30 hours.
const flowForecast: ForecastPoint[] = Array.from({ length: 30 }, (_, h) => ({
  time: at(h),
  values: { flow: toSI(3.4, 'kcfs') },
  provenance: {
    flow: {
      kind: 'forecast',
      asOf: '2026-10-26T06:00:00.000Z',
      source: 'nwps',
      sourceRef: 'MNTM3',
    },
  },
}));

function adapters() {
  const usgs: FlowSource = {
    id: 'usgs',
    findNearby: vi.fn(),
    getGauge: vi.fn(async () => ok(montague)),
    getLatest: vi.fn(async () => ok(usgsLatest)),
    getHistory: vi.fn(),
  };
  const nwps: FlowForecastSource = {
    id: 'nwps',
    findNearby: vi.fn(),
    getGauge: vi.fn(async () => ok(mntm3)),
    getStageFlow: vi.fn(async () =>
      ok({ observed: [], forecast: flowForecast, issuedAt: '2026-10-26T06:00:00.000Z' }),
    ),
  };
  const nws: WeatherSource = {
    id: 'nws',
    getPoint: vi.fn(async () =>
      ok({
        gridId: 'BOX',
        gridX: 20,
        gridY: 103,
        timeZone: 'America/New_York',
        place: 'Turners Falls, MA',
      }),
    ),
    getHourlyForecast: vi.fn(async (_lat, _lon, hours: number) => ok(weather(hours))),
    getCurrent: vi.fn(async () =>
      ok({
        basis: 'station' as const,
        station: { id: 'KORE', name: 'Orange Municipal Airport', distanceKm: 21.8 },
        readings: [
          {
            metric: 'windSpeed' as const,
            value: 2,
            observedAt: '2026-10-26T11:52:00.000Z',
            fetchedAt: T0,
            source: 'nws' as const,
            sourceRef: 'KORE',
          },
        ],
      }),
    ),
    getAlerts: vi.fn(async () => ok([])),
  };
  return { usgs, nwps, nws };
}

let close: () => Promise<void>;
let deps: ConditionsDeps;
let clock: Date;
beforeEach(async () => {
  const database = await createTestDatabase();
  close = database.close;
  clock = new Date('2026-10-26T12:20:00.000Z');
  deps = {
    ...adapters(),
    cache: createSourceCache({ db: database.db, logger: { warn: vi.fn() }, now: () => clock }),
    now: () => clock,
  };
});
afterEach(async () => {
  await close();
});

const conditions = (input: Partial<Parameters<typeof getConditions>[0]> = {}) =>
  getConditions({ lat: LAT, lon: LON, gaugeRef: 'usgs:USGS-01170500', ...input }, deps);

const failAll = () => {
  for (const fn of [deps.usgs.getGauge, deps.usgs.getLatest])
    vi.mocked(fn).mockResolvedValue(fail('usgs'));
  for (const fn of [deps.nwps.getGauge, deps.nwps.getStageFlow])
    vi.mocked(fn).mockResolvedValue(fail('nwps'));
  for (const fn of [
    deps.nws.getPoint,
    deps.nws.getHourlyForecast,
    deps.nws.getCurrent,
    deps.nws.getAlerts,
  ]) {
    vi.mocked(fn).mockResolvedValue(fail('nws'));
  }
};

describe('getConditions when every source answers', () => {
  it('returns a valid response with every source ok', async () => {
    const r = await conditions();
    expect(ConditionsResponse.safeParse(r).success).toBe(true);
    expect(r.sources).toEqual([
      { id: 'usgs', status: 'ok', fetchedAt: '2026-10-26T12:20:00.000Z' },
      { id: 'nwps', status: 'ok', fetchedAt: '2026-10-26T12:20:00.000Z' },
      { id: 'nws', status: 'ok', fetchedAt: '2026-10-26T12:20:00.000Z' },
    ]);
    expect(r.location).toEqual({
      lat: LAT,
      lon: LON,
      timezone: 'America/New_York',
      place: 'Turners Falls, MA',
    });
    expect(r.gauge).toEqual({ ref: montague.ref, name: montague.name, lat: 42.58, lon: -72.57 });
  });

  it('returns 48 hours from the current hour, merging weather and forecast flow', async () => {
    const r = await conditions();
    expect(r.forecast).toHaveLength(FORECAST_HOURS);
    expect(r.forecast[0]?.time).toBe(at(0));
    expect(r.forecast[0]?.values).toMatchObject({ windSpeed: 3, flow: toSI(3.4, 'kcfs') });
    expect(r.forecast[0]?.provenance.flow).toMatchObject({ kind: 'forecast', source: 'nwps' });
    // The NWPS forecast covers 30 hours; after it, flow is missing.
    expect(r.forecast[35]?.values.flow).toBeNull();
  });

  it('uses the latest observation for every hour when the gauge has no forecast', async () => {
    vi.mocked(deps.nwps.getGauge).mockResolvedValue(ok({ ...mntm3, hasFlowForecast: false }));
    const r = await conditions();
    expect(deps.nwps.getStageFlow).not.toHaveBeenCalled();
    expect(r.forecast.every((p) => p.values.flow === toSI(5060, 'cfs'))).toBe(true);
    expect(r.forecast[40]?.provenance.flow?.kind).toBe('observation');
  });

  it('combines current weather from the station with the gauge reading', async () => {
    const r = await conditions();
    expect(r.currentBasis).toBe('station');
    expect(r.station?.id).toBe('KORE');
    expect(r.current.map((x) => x.metric).sort()).toEqual(['flow', 'windSpeed']);
  });

  it('returns daylight for each local date in the window', async () => {
    const r = await conditions();
    expect(r.daylight.map((d) => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
  });

  it('uses local dates, not UTC: just after midnight UTC it is still the previous evening here', async () => {
    clock = new Date('2026-10-26T00:10:00.000Z'); // 20:10 on October 25 in Massachusetts
    const r = await conditions();
    expect(r.daylight.map((d) => d.date)).toEqual(['2026-10-25', '2026-10-26', '2026-10-27']);
  });

  it('works weather-only for a location without a gauge', async () => {
    const r = await conditions({ gaugeRef: undefined });
    expect(r.gauge).toBeUndefined();
    expect(r.sources.map((s) => s.id)).toEqual(['nws']);
    expect(r.forecast[0]?.values).not.toHaveProperty('flow');
  });

  it('builds each flow series from its own gauge, not the display gauge', async () => {
    vi.mocked(deps.nwps.getStageFlow).mockImplementation(async (lid) =>
      ok({
        observed: [],
        forecast: flowForecast.map((p) => ({
          ...p,
          values: { flow: lid === 'WDEM3' ? toSI(1.1, 'kcfs') : toSI(3.4, 'kcfs') },
        })),
        issuedAt: '2026-10-26T06:00:00.000Z',
      }),
    );
    const r = await conditions({ flowGaugeRefs: ['nwps:WDEM3'] });
    expect(r.flowSeries[0]?.points[0]?.values.flow).toBe(toSI(1.1, 'kcfs'));
    expect(r.forecast[0]?.values.flow).toBe(toSI(3.4, 'kcfs'));
  });

  it('adds flow series for gauges rule sets name, which evaluation can use', async () => {
    const r = await conditions({ flowGaugeRefs: ['nwps:MNTM3'] });
    expect(r.flowSeries).toHaveLength(1);
    const series = r.flowSeries[0];
    expect(series?.gaugeRef).toBe('nwps:MNTM3');
    expect(series?.points).toHaveLength(FORECAST_HOURS);
    expect(series?.points[0]?.values).toEqual({ flow: toSI(3.4, 'kcfs') });

    // The response plugs straight into core evaluation.
    const timeline = evaluateTimeline({
      forecast: r.forecast,
      flowByGauge: Object.fromEntries(r.flowSeries.map((s) => [s.gaugeRef, s.points])),
      ruleSet: {
        id: 'rs',
        name: 'Club A',
        boatClasses: [{ id: 'all', name: 'All' }],
        thresholds: [
          {
            id: 't',
            metric: 'flow',
            comparison: 'max',
            boundary: 'inclusive',
            value: toSI(20, 'kcfs'),
            enteredUnit: 'kcfs',
          },
        ],
        flowGaugeRef: 'nwps:MNTM3',
      },
      boatClassId: 'all',
      lat: LAT,
      lon: LON,
      now: clock.toISOString(),
    });
    expect(timeline.hours[0]?.status).toBe('within');
  });
});

describe('getConditions with failures', () => {
  it('returns what is available when one source fails, reporting it', async () => {
    vi.mocked(deps.nws.getHourlyForecast).mockResolvedValue(fail('nws'));
    const r = await conditions();
    expect(ConditionsResponse.safeParse(r).success).toBe(true);
    expect(r.sources.find((s) => s.id === 'nws')).toEqual({
      id: 'nws',
      status: 'error',
      fetchedAt: '2026-10-26T12:20:00.000Z',
      message: 'nws timed out',
    });
    expect(r.sources.find((s) => s.id === 'usgs')?.status).toBe('ok');
    expect(r.forecast).toHaveLength(FORECAST_HOURS);
    expect(r.forecast[0]?.values).not.toHaveProperty('windSpeed');
    expect(r.forecast[0]?.values.flow).toBe(toSI(3.4, 'kcfs'));
  });

  it('serves cached data marked stale when every source fails after it expires', async () => {
    await conditions();
    clock = new Date(clock.getTime() + 2 * HOUR); // past every short TTL
    failAll();
    const r = await conditions();
    expect(ConditionsResponse.safeParse(r).success).toBe(true);
    expect(r.sources.map((s) => s.status)).toEqual(['stale', 'stale', 'stale']);
    expect(r.sources[0]?.message).toBe('usgs timed out');
    expect(r.current.length).toBeGreaterThan(0);
    // The cached forecast was fetched 72 hours deep, so the window still starts at the current hour.
    expect(r.forecast[0]?.time).toBe('2026-10-26T14:00:00.000Z');
    expect(r.forecast[0]?.values.windSpeed).toBe(3);
    expect(r.forecast[47]?.values.windSpeed).toBe(3);
  });

  it('reports a source as error when one of its calls failed with nothing cached, even if others are stale', async () => {
    vi.mocked(deps.nws.getAlerts).mockResolvedValue(fail('nws'));
    await conditions(); // alerts fail and are not cached; the rest is
    clock = new Date(clock.getTime() + 2 * HOUR);
    failAll();
    const r = await conditions();
    expect(r.sources.find((s) => s.id === 'nws')?.status).toBe('error');
  });

  it("reports a source's oldest data as its fetch time", async () => {
    const first = clock.toISOString();
    await conditions();
    clock = new Date(clock.getTime() + 40 * 60_000); // forecast expired; the point lookup has not
    const r = await conditions();
    expect(r.sources.find((s) => s.id === 'nws')?.fetchedAt).toBe(first);
  });

  it('returns an empty but valid response when every source fails with nothing cached', async () => {
    failAll();
    const r = await conditions({ flowGaugeRefs: ['nwps:MNTM3'] });
    expect(ConditionsResponse.safeParse(r).success).toBe(true);
    expect(r.sources).toEqual([
      { id: 'usgs', status: 'error', message: 'usgs timed out' },
      { id: 'nwps', status: 'error', message: 'nwps timed out' },
      { id: 'nws', status: 'error', message: 'nws timed out' },
    ]);
    expect(r.current).toEqual([]);
    expect(r.location.timezone).toBeNull();
    expect(r.forecast).toHaveLength(FORECAST_HOURS);
    expect(r.forecast.every((p) => Object.keys(p.values).length === 0)).toBe(true);
    expect(r.flowSeries[0]?.points.every((p) => p.values.flow === undefined)).toBe(true);
  });

  it('caches responses, so a second request within the TTL calls no adapter', async () => {
    await conditions();
    vi.clearAllMocks();
    await conditions();
    expect(deps.usgs.getLatest).not.toHaveBeenCalled();
    expect(deps.nws.getHourlyForecast).not.toHaveBeenCalled();
    expect(deps.nwps.getStageFlow).not.toHaveBeenCalled();
  });
});
