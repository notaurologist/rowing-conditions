import { ForecastPoint, NearbyGauge, Reading, toSI } from '@rowing/core';
import { describe, expect, it, vi } from 'vitest';
import { fixture, json, type Route, routedFetch } from '../../../test/fixtures.ts';
import type { Logger } from '../http.ts';
import { createNwpsAdapter } from './nwps.ts';

const NOW = new Date('2026-10-25T23:45:00Z');
const routes: Route[] = [
  { path: '/nwps/v1/gauges', respond: fixture('nwps/nearby-turners-falls') },
  { path: '/nwps/v1/gauges/MNTM3', respond: fixture('nwps/gauge-mntm3') },
  { path: '/nwps/v1/gauges/01161280', respond: fixture('nwps/gauge-by-usgs-01161280') },
  { path: '/nwps/v1/gauges/MNTM3/stageflow', respond: fixture('nwps/stageflow-mntm3') },
  { path: '/nwps/v1/gauges/NFDM3/stageflow', respond: fixture('nwps/stageflow-nfdm3') },
];

function adapter(r: Route[] = routes) {
  const fetch = routedFetch(r);
  const logger: Logger = { warn: vi.fn() };
  return { nwps: createNwpsAdapter({ fetch, logger, now: () => NOW }), fetch, logger };
}

async function stageFlow(lid: string, r?: Route[]) {
  const result = await adapter(r).nwps.getStageFlow(lid);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe('getGauge', () => {
  it('returns a forecast point with its linked USGS gauge', async () => {
    expect(await adapter().nwps.getGauge('MNTM3')).toEqual({
      ok: true,
      data: {
        ref: 'nwps:MNTM3',
        source: 'nwps',
        name: 'Connecticut River at Montague',
        lat: 42.5802222,
        lon: -72.5745,
        metrics: ['flow', 'gaugeHeight'],
        hasFlowForecast: true,
        linkedRef: 'usgs:USGS-01170500',
      },
    });
  });

  it('finds the forecast point for a USGS site number, and reports when it has no forecast', async () => {
    const result = await adapter().nwps.getGauge('01161280');
    expect(result.ok && result.data).toMatchObject({
      ref: 'nwps:NFDM3',
      hasFlowForecast: false,
      linkedRef: 'usgs:USGS-01161280',
    });
  });

  it('returns null for an unknown gauge', async () => {
    const r = adapter([
      { path: '/nwps/v1/gauges/NOPE1', respond: json({ code: 5, message: 'could not find' }, 404) },
    ]);
    expect(await r.nwps.getGauge('NOPE1')).toEqual({ ok: true, data: null });
  });
});

describe('findNearby', () => {
  it('returns gauges within the radius, nearest first, saying which have forecasts', async () => {
    const result = await adapter().nwps.findNearby(42.6, -72.55, 20);
    if (!result.ok) throw new Error(result.error.message);
    for (const g of result.data) expect(NearbyGauge.safeParse(g).success).toBe(true);
    const byLid = Object.fromEntries(result.data.map((g) => [g.ref, g.hasFlowForecast]));
    expect(byLid).toMatchObject({ 'nwps:MNTM3': true, 'nwps:NFDM3': false, 'nwps:EROM3': false });
    const distances = result.data.map((g) => g.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    // List entries carry no USGS ID, so nothing is linked from the search alone.
    expect(result.data.every((g) => g.linkedRef === undefined)).toBe(true);
  });

  it('excludes gauges outside the radius even when the search box returns them', async () => {
    const result = await adapter().nwps.findNearby(42.6, -72.55, 5);
    expect(result.ok && result.data.map((g) => g.ref)).toEqual(['nwps:MNTM3']);
  });

  it('leaves out gauges marked out of service', async () => {
    const gauge = {
      lid: 'OUTM3',
      name: 'Out',
      latitude: 42.6,
      longitude: -72.55,
      pedts: { observed: 'HGIRG', forecast: '' },
      inService: { enabled: false },
    };
    const r = adapter([{ path: '/nwps/v1/gauges', respond: json({ gauges: [gauge] }) }]);
    expect(await r.nwps.findNearby(42.6, -72.55, 10)).toEqual({ ok: true, data: [] });
  });
});

describe('getStageFlow with a forecast (MNTM3)', () => {
  it('converts observed flow from kcfs and stage from ft to SI', async () => {
    const { observed } = await stageFlow('MNTM3');
    const latestFlow = observed.filter((r) => r.metric === 'flow').at(-1);
    expect(latestFlow?.value).toBeCloseTo(toSI(5.04, 'kcfs'), 9);
    expect(latestFlow).toMatchObject({
      observedAt: '2026-10-25T23:30:00.000Z',
      fetchedAt: NOW.toISOString(),
      source: 'nwps',
      sourceRef: 'MNTM3',
    });
    expect(observed.filter((r) => r.metric === 'gaugeHeight').at(-1)?.value).toBeCloseTo(
      toSI(8.19, 'ft'),
      9,
    );
    for (const r of observed) expect(Reading.safeParse(r).success).toBe(true);
  });

  it('returns the forecast hourly, with its issue time, from the first to the last step', async () => {
    const { forecast, issuedAt } = await stageFlow('MNTM3');
    expect(issuedAt).toBe('2026-10-25T14:44:00.000Z');
    expect(forecast[0]?.time).toBe('2026-10-25T18:00:00.000Z');
    expect(forecast.at(-1)?.time).toBe('2026-10-28T12:00:00.000Z');
    expect(forecast).toHaveLength(67); // 66 hours between the first and last 6-hourly steps
    for (const p of forecast) expect(ForecastPoint.safeParse(p).success).toBe(true);
  });

  it('keeps step values exact and interpolates the hours between, marking them', async () => {
    const { forecast } = await stageFlow('MNTM3');
    const at = (time: string) => forecast.find((p) => p.time === time);
    // Steps: 3.38 kcfs at 00:00 and 3.23 kcfs at 06:00 on October 26.
    const step = at('2026-10-26T00:00:00.000Z');
    expect(step?.values.flow).toBeCloseTo(toSI(3.38, 'kcfs'), 9);
    expect(step?.provenance.flow?.interpolated).toBeUndefined();
    const between = at('2026-10-26T03:00:00.000Z');
    expect(between?.values.flow).toBeCloseTo(toSI((3.38 + 3.23) / 2, 'kcfs'), 9);
    expect(between?.provenance.flow).toEqual({
      kind: 'forecast',
      asOf: '2026-10-25T14:44:00.000Z',
      source: 'nwps',
      sourceRef: 'MNTM3',
      interpolated: true,
    });
    expect(between?.values.gaugeHeight).toBeCloseTo(toSI(7.15, 'ft'), 9);
  });
});

describe('getStageFlow without a forecast (NFDM3)', () => {
  it('returns no forecast and no issue time, ignoring the 0001-01-01 placeholder', async () => {
    const { forecast, issuedAt } = await stageFlow('NFDM3');
    expect(forecast).toEqual([]);
    expect(issuedAt).toBeNull();
  });

  it('treats -999 flow as missing while keeping the stage', async () => {
    const { observed } = await stageFlow('NFDM3');
    const flows = observed.filter((r) => r.metric === 'flow');
    expect(flows.length).toBeGreaterThan(0);
    expect(flows.every((r) => r.value === null)).toBe(true);
    expect(observed.filter((r) => r.metric === 'gaugeHeight').at(-1)?.value).toBeCloseTo(
      toSI(11.9, 'ft'),
      9,
    );
  });
});

const synthetic = (overrides: Record<string, unknown>) => {
  const series = {
    issuedTime: '2026-10-25T12:00:00Z',
    primaryUnits: 'ft',
    secondaryUnits: 'kcfs',
    data: [
      { validTime: '2026-10-26T00:00:00Z', primary: 7, secondary: 3 },
      { validTime: '2026-10-26T06:00:00Z', primary: 7, secondary: -999 },
    ],
    ...overrides,
  };
  return [
    {
      path: '/nwps/v1/gauges/TSTM3/stageflow',
      respond: json({ observed: { ...series, data: [] }, forecast: series }),
    },
  ];
};

describe('getStageFlow edge cases', () => {
  it('treats a forecast with the placeholder issue time as no forecast, even with data', async () => {
    const result = await stageFlow('TSTM3', synthetic({ issuedTime: '0001-01-01T00:00:00Z' }));
    expect(result.forecast).toEqual([]);
    expect(result.issuedAt).toBeNull();
  });

  it('keeps a negative observed flow, marked as reversed (#116)', async () => {
    const observed = {
      issuedTime: '0001-01-01T00:00:00Z',
      primaryUnits: 'ft',
      secondaryUnits: 'kcfs',
      data: [{ validTime: '2026-10-25T23:00:00Z', primary: 7, secondary: -1.6 }],
    };
    const result = await stageFlow('TSTM3', [
      {
        path: '/nwps/v1/gauges/TSTM3/stageflow',
        respond: json({ observed, forecast: { ...observed, data: [] } }),
      },
    ]);
    const flow = result.observed.find((r) => r.metric === 'flow');
    expect(flow?.value).toBeCloseTo(toSI(-1.6, 'kcfs'), 9);
    expect(flow?.qualifiers).toEqual(['reversedFlow']);
    expect(result.observed.find((r) => r.metric === 'gaugeHeight')?.qualifiers).toBeUndefined();
  });

  it('treats a forecast with an issue time but no data as no forecast', async () => {
    const result = await stageFlow('TSTM3', synthetic({ data: [] }));
    expect(result.issuedAt).toBeNull();
  });

  it('leaves forecast hours next to a missing step as null', async () => {
    const { forecast } = await stageFlow('TSTM3', synthetic({}));
    expect(forecast.map((p) => p.values.flow === null)).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('skips and logs a series in a unit it does not know', async () => {
    const r = adapter(synthetic({ secondaryUnits: 'Mgal/d' }));
    const result = await r.nwps.getStageFlow('TSTM3');
    expect(result.ok && result.data.forecast.every((p) => p.values.flow === undefined)).toBe(true);
    expect(r.logger.warn).toHaveBeenCalledWith(
      'nwps: unknown unit, series skipped',
      expect.anything(),
    );
  });

  it('returns an error result instead of throwing on a server error', async () => {
    const r = adapter([{ path: '/nwps/v1/gauges/TSTM3/stageflow', respond: json({}, 503) }]);
    expect(await r.nwps.getStageFlow('TSTM3')).toMatchObject({
      ok: false,
      error: { source: 'nwps', kind: 'http', status: 503 },
    });
  });
});
