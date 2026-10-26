import { NearbyGauge, Reading, toSI } from '@rowing/core';
import { describe, expect, it, vi } from 'vitest';
import { fixture, json, type Route, routedFetch } from '../../../test/fixtures.ts';
import type { Logger } from '../http.ts';
import { createUsgsAdapter } from './usgs.ts';

const MONTAGUE = 'USGS-01170500';
const NORTHFIELD = 'USGS-01161280';
const ICE = 'USGS-15743850';
const NOW = new Date('2026-10-25T23:30:00Z');

const fixtureRoutes: Route[] = [
  {
    path: '/collections/monitoring-locations/items',
    respond: fixture('usgs/nearby-turners-falls'),
  },
  {
    path: `/collections/monitoring-locations/items/${MONTAGUE}`,
    respond: fixture('usgs/location-montague'),
  },
  {
    path: '/collections/time-series-metadata/items',
    respond: fixture('usgs/metadata-montague-northfield'),
  },
  {
    path: '/collections/latest-continuous/items',
    query: { monitoring_location_id: MONTAGUE },
    respond: fixture('usgs/latest-montague'),
  },
  {
    path: '/collections/latest-continuous/items',
    query: { monitoring_location_id: NORTHFIELD },
    respond: fixture('usgs/latest-northfield'),
  },
  {
    path: '/collections/latest-continuous/items',
    query: { monitoring_location_id: ICE },
    respond: fixture('usgs/latest-ice'),
  },
  { path: '/collections/continuous/items', respond: fixture('usgs/history-montague-flow') },
];

function adapter(routes: Route[] = fixtureRoutes, extra: { apiKey?: string } = {}) {
  const fetch = routedFetch(routes);
  const logger: Logger = { warn: vi.fn() };
  return { usgs: createUsgsAdapter({ fetch, logger, now: () => NOW, ...extra }), fetch, logger };
}

const reading = (readings: Reading[], metric: string) => readings.find((r) => r.metric === metric);

describe('getLatest', () => {
  it('converts flow from ft³/s and gauge height from ft to SI, with provenance', async () => {
    const result = await adapter().usgs.getLatest(MONTAGUE);
    if (!result.ok) throw new Error(result.error.message);
    const flow = reading(result.data, 'flow');
    expect(flow?.value).toBeCloseTo(toSI(5060, 'cfs'), 9);
    expect(reading(result.data, 'gaugeHeight')?.value).toBeCloseTo(toSI(8.2, 'ft'), 9);
    expect(flow).toMatchObject({
      observedAt: '2026-10-25T23:15:00.000Z',
      fetchedAt: NOW.toISOString(),
      source: 'usgs',
      sourceRef: MONTAGUE,
      qualifiers: ['provisional'],
    });
    for (const r of result.data) expect(Reading.safeParse(r).success).toBe(true);
  });

  it('returns no water temperature for a gauge without that sensor', async () => {
    const result = await adapter().usgs.getLatest(MONTAGUE);
    expect(result.ok && reading(result.data, 'waterTemp')).toBeUndefined();
  });

  it('returns water temperature in °C where the gauge reports it', async () => {
    const result = await adapter().usgs.getLatest(NORTHFIELD);
    expect(result.ok && reading(result.data, 'waterTemp')?.value).toBe(11.8);
  });

  it('keeps an ice-affected reading with a null value and the iceAffected qualifier', async () => {
    const result = await adapter().usgs.getLatest(ICE);
    if (!result.ok) throw new Error(result.error.message);
    expect(reading(result.data, 'flow')).toMatchObject({
      value: null,
      qualifiers: ['provisional', 'iceAffected'],
    });
    expect(reading(result.data, 'gaugeHeight')?.value).toBeCloseTo(toSI(4.75, 'ft'), 9);
  });

  it('treats a negative flow (reverse flow) as missing and logs it', async () => {
    const { usgs, logger } = adapter();
    const result = await usgs.getLatest(NORTHFIELD); // the fixture has -1620 ft³/s
    expect(result.ok && reading(result.data, 'flow')?.value).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'usgs: reading out of range, treated as missing',
      expect.objectContaining({ gauge: NORTHFIELD }),
    );
  });
});

const syntheticReading = (overrides: Record<string, unknown>) => ({
  type: 'FeatureCollection',
  features: [
    {
      properties: {
        monitoring_location_id: MONTAGUE,
        parameter_code: '00060',
        statistic_id: '00011',
        time: '2026-10-25T23:15:00+00:00',
        value: '100',
        unit_of_measure: 'ft^3/s',
        approval_status: 'Approved',
        qualifier: null,
        ...overrides,
      },
    },
  ],
});

const latestRoute = (body: unknown): Route[] => [
  { path: '/collections/latest-continuous/items', respond: json(body) },
];

describe('getLatest with unusual readings', () => {
  it('maps an unrecognized qualifier to unreliable and logs the code', async () => {
    const { usgs, logger } = adapter(latestRoute(syntheticReading({ qualifier: ['NEWCODE'] })));
    const result = await usgs.getLatest(MONTAGUE);
    expect(result.ok && result.data[0]?.qualifiers).toEqual(['unreliable']);
    expect(logger.warn).toHaveBeenCalledWith(
      'usgs: unrecognized qualifier codes treated as unreliable',
      expect.objectContaining({ codes: ['NEWCODE'] }),
    );
  });

  it('skips readings that are not instantaneous values', async () => {
    const { usgs } = adapter(latestRoute(syntheticReading({ statistic_id: '00003' })));
    expect(await usgs.getLatest(MONTAGUE)).toEqual({ ok: true, data: [] });
  });

  it('skips and logs a reading in a unit it does not know, rather than converting it wrongly', async () => {
    const { usgs, logger } = adapter(latestRoute(syntheticReading({ unit_of_measure: 'Mgal/d' })));
    expect(await usgs.getLatest(MONTAGUE)).toEqual({ ok: true, data: [] });
    expect(logger.warn).toHaveBeenCalledWith(
      'usgs: unknown unit, reading skipped',
      expect.anything(),
    );
  });

  it('treats an unparseable value as missing', async () => {
    const { usgs } = adapter(latestRoute(syntheticReading({ value: 'Ice' })));
    const result = await usgs.getLatest(MONTAGUE);
    expect(result.ok && result.data[0]?.value).toBeNull();
  });

  it('returns readings in time order whatever order USGS sends them in', async () => {
    const later = syntheticReading({ time: '2026-10-25T23:15:00+00:00' }).features[0];
    const earlier = syntheticReading({ time: '2026-10-25T22:15:00+00:00' }).features[0];
    const { usgs } = adapter(
      latestRoute({ type: 'FeatureCollection', features: [later, earlier] }),
    );
    const result = await usgs.getLatest(MONTAGUE);
    expect(result.ok && result.data.map((r) => r.observedAt)).toEqual([
      '2026-10-25T22:15:00.000Z',
      '2026-10-25T23:15:00.000Z',
    ]);
  });
});

describe('getHistory', () => {
  it('returns flow readings in time order, converted to SI', async () => {
    const result = await adapter().usgs.getHistory(
      MONTAGUE,
      'flow',
      '2026-10-25T17:00:00.000Z',
      '2026-10-25T23:00:00.000Z',
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data).toHaveLength(25);
    expect(result.data[0]?.value).toBeCloseTo(toSI(2120, 'cfs'), 9);
    expect(result.data.at(-1)?.value).toBeCloseTo(toSI(5230, 'cfs'), 9);
    const times = result.data.map((r) => r.observedAt);
    expect([...times].sort()).toEqual(times);
  });

  it('returns nothing for a metric USGS does not report, without a request', async () => {
    const { usgs, fetch } = adapter();
    expect(await usgs.getHistory(MONTAGUE, 'windSpeed', 'a', 'b')).toEqual({ ok: true, data: [] });
    expect(fetch.calls).toHaveLength(0);
  });
});

describe('findNearby', () => {
  it('returns gauges within the radius, nearest first, with what each reports', async () => {
    const result = await adapter().usgs.findNearby(42.6, -72.55, 15);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.length).toBeGreaterThan(0);
    for (const g of result.data) {
      expect(NearbyGauge.safeParse(g).success).toBe(true);
      expect(g.distanceKm).toBeLessThanOrEqual(15);
      expect(g.metrics.length).toBeGreaterThan(0);
    }
    const distances = result.data.map((g) => g.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);

    const montague = result.data.find((g) => g.ref === `usgs:${MONTAGUE}`);
    expect(montague).toMatchObject({
      source: 'usgs',
      name: 'CONNECTICUT RIVER AT MONTAGUE CITY, MA',
    });
    expect(montague?.metrics.sort()).toEqual(['flow', 'gaugeHeight']);
    const northfield = result.data.find((g) => g.ref === `usgs:${NORTHFIELD}`);
    expect(northfield?.metrics.sort()).toEqual(['flow', 'gaugeHeight', 'waterTemp']);
  });

  it('excludes gauges outside the radius even when inside the search box', async () => {
    const result = await adapter().usgs.findNearby(42.6, -72.55, 5);
    expect(result.ok && result.data.every((g) => g.distanceKm <= 5)).toBe(true);
  });

  it('makes no metadata request when nothing is nearby', async () => {
    const { usgs, fetch } = adapter([
      {
        path: '/collections/monitoring-locations/items',
        respond: json({ type: 'FeatureCollection', features: [] }),
      },
    ]);
    expect(await usgs.findNearby(42.6, -72.55, 10)).toEqual({ ok: true, data: [] });
    expect(fetch.calls).toHaveLength(1);
  });

  it('logs when the search has more than one page', async () => {
    const { usgs, logger } = adapter([
      {
        path: '/collections/monitoring-locations/items',
        respond: json({
          type: 'FeatureCollection',
          features: [],
          links: [{ rel: 'next', href: 'x' }],
        }),
      },
    ]);
    await usgs.findNearby(42.6, -72.55, 10);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('more results than one page'));
  });
});

describe('getGauge', () => {
  it('returns the gauge with its coordinates and metrics', async () => {
    const result = await adapter().usgs.getGauge(MONTAGUE);
    expect(result).toEqual({
      ok: true,
      data: {
        ref: `usgs:${MONTAGUE}`,
        source: 'usgs',
        name: 'CONNECTICUT RIVER AT MONTAGUE CITY, MA',
        lat: 42.5802222222222,
        lon: -72.5745,
        metrics: ['flow', 'gaugeHeight'],
      },
    });
  });

  it('returns null for a gauge that does not exist', async () => {
    const { usgs } = adapter([
      { path: '/collections/monitoring-locations/items/USGS-99999999', respond: json({}, 404) },
    ]);
    expect(await usgs.getGauge('USGS-99999999')).toEqual({ ok: true, data: null });
  });

  it('counts only real-time series, not daily or annual ones', async () => {
    const series = (parameter_code: string, statistic_id: string | null) => ({
      properties: { monitoring_location_id: MONTAGUE, parameter_code, statistic_id },
    });
    const { usgs } = adapter([
      {
        path: `/collections/monitoring-locations/items/${MONTAGUE}`,
        respond: fixture('usgs/location-montague'),
      },
      {
        path: '/collections/time-series-metadata/items',
        respond: json({
          type: 'FeatureCollection',
          features: [series('00060', '00011'), series('00010', '00003'), series('00065', null)],
        }),
      },
    ]);
    const result = await usgs.getGauge(MONTAGUE);
    expect(result.ok && result.data?.metrics).toEqual(['flow']);
  });
});

describe('errors and requests', () => {
  it('returns an error result instead of throwing on a server error', async () => {
    const { usgs } = adapter(latestRoute({}));
    const failing = adapter([
      { path: '/collections/latest-continuous/items', respond: json({}, 500) },
    ]);
    expect(await failing.usgs.getLatest(MONTAGUE)).toMatchObject({
      ok: false,
      error: { source: 'usgs', kind: 'http', status: 500 },
    });
    expect(await usgs.getLatest(MONTAGUE)).toMatchObject({ ok: false, error: { kind: 'parse' } });
  });

  it('sends the API key only when one is configured', async () => {
    const calls: RequestInit[] = [];
    const capture = (key?: string) =>
      createUsgsAdapter({
        fetch: async (_url, init) => {
          calls.push(init ?? {});
          return json(syntheticReading({}))();
        },
        logger: { warn: vi.fn() },
        ...(key !== undefined ? { apiKey: key } : {}),
      });
    await capture('test-key').getLatest(MONTAGUE);
    await capture().getLatest(MONTAGUE);
    await capture('').getLatest(MONTAGUE);
    const keys = calls.map((c) => (c.headers as Record<string, string>)['X-Api-Key']);
    expect(keys).toEqual(['test-key', undefined, undefined]);
  });
});
