import type { ForecastPoint, Reading } from '@rowing/core';
import { describe, expect, it } from 'vitest';
import { FORECAST_DISAGREEMENT, riverHours } from './riverHours.ts';

const t = (hour: number) => new Date(Date.UTC(2026, 9, 26, hour)).toISOString();
const hours = [t(0), t(1), t(2), t(3), t(4)];

const observed = (metric: Reading['metric'], value: number | null, at: string): Reading => ({
  metric,
  value,
  observedAt: at,
  fetchedAt: t(0),
  source: 'usgs',
  sourceRef: 'USGS-01170500',
  qualifiers: ['provisional'],
});

const forecastPoint = (time: string, flow: number | null, gaugeHeight?: number): ForecastPoint => ({
  time,
  values: { flow, ...(gaugeHeight === undefined ? {} : { gaugeHeight }) },
  provenance: {
    flow: {
      kind: 'forecast',
      asOf: '2026-10-25T14:44:00.000Z',
      source: 'nwps',
      sourceRef: 'MNTM3',
    },
    ...(gaugeHeight === undefined
      ? {}
      : {
          gaugeHeight: {
            kind: 'forecast' as const,
            asOf: '2026-10-25T14:44:00.000Z',
            source: 'nwps' as const,
            sourceRef: 'MNTM3',
          },
        }),
  },
});

describe('riverHours without a flow forecast', () => {
  it('copies the latest observation to hours starting within 3 hours of it (#117)', () => {
    const latest = [
      observed('flow', 100, '2026-10-25T23:45:00.000Z'),
      observed('flow', 143, '2026-10-26T00:15:00.000Z'), // the most recent wins
      observed('waterTemp', 9.5, '2026-10-26T00:00:00.000Z'),
    ];
    const result = riverHours(hours, [], latest);
    expect(result).toHaveLength(5);
    // 00:00 to 03:00 start before 03:15, three hours after the reading.
    for (const h of result.slice(0, 4)) {
      expect(h.values).toEqual({ flow: 143, waterTemp: 9.5 });
      expect(h.provenance.flow).toEqual({
        kind: 'observation',
        asOf: '2026-10-26T00:15:00.000Z',
        source: 'usgs',
        sourceRef: 'USGS-01170500',
        qualifiers: ['provisional'],
      });
    }
  });

  it('withholds flow and gauge height after that as no forecast, keeping water temperature', () => {
    const latest = [
      observed('flow', 143, t(0)),
      observed('gaugeHeight', 2.5, t(0)),
      observed('waterTemp', 9.5, t(0)),
    ];
    const result = riverHours(hours, [], latest);
    expect(result[2]?.values).toEqual({ flow: 143, gaugeHeight: 2.5, waterTemp: 9.5 });
    for (const h of result.slice(3)) {
      expect(h.values).toEqual({ flow: null, gaugeHeight: null, waterTemp: 9.5 });
      expect(h.provenance.flow).toMatchObject({
        kind: 'observation',
        asOf: t(0),
        withheld: 'noForecast',
      });
      expect(h.provenance.gaugeHeight?.withheld).toBe('noForecast');
    }
  });

  it('withholds every hour when the reading is already 3 hours old', () => {
    const result = riverHours(hours, [], [observed('flow', 143, '2026-10-25T21:00:00.000Z')]);
    expect(result.every((h) => h.values.flow === null)).toBe(true);
    expect(result[0]?.provenance.flow?.withheld).toBe('noForecast');
  });

  it('keeps a null latest value as missing, with its provenance', () => {
    const result = riverHours(hours, [], [observed('flow', null, t(0))]);
    expect(result[2]?.values.flow).toBeNull();
    expect(result[2]?.provenance.flow?.kind).toBe('observation');
  });

  it('leaves out a metric the gauge has no reading for, so it counts as no source', () => {
    const result = riverHours(hours, [], [observed('flow', 143, t(0))]);
    expect(result[0]?.values).not.toHaveProperty('waterTemp');
    expect(result[0]?.provenance).not.toHaveProperty('waterTemp');
  });
});

describe('riverHours with a flow forecast', () => {
  const forecast = [
    forecastPoint(t(1), 120, 2.4),
    forecastPoint(t(2), 125, 2.5),
    forecastPoint(t(3), 130, 2.6),
  ];
  const latest = [
    observed('flow', 143, t(0)),
    observed('gaugeHeight', 2.5, t(0)),
    observed('waterTemp', 9.5, t(0)),
  ];
  const result = riverHours(hours, forecast, latest);

  it('uses forecast values and provenance for the hours the forecast covers', () => {
    expect(result[1]?.values.flow).toBe(120);
    expect(result[2]?.values.gaugeHeight).toBe(2.5);
    expect(result[3]?.provenance.flow).toMatchObject({
      kind: 'forecast',
      source: 'nwps',
      sourceRef: 'MNTM3',
    });
  });

  it('uses the latest observation for hours before the forecast starts', () => {
    expect(result[0]?.values.flow).toBe(143);
    expect(result[0]?.provenance.flow?.kind).toBe('observation');
  });

  it('leaves hours after the last forecast step missing, never the observation', () => {
    expect(result[4]?.values.flow).toBeNull();
    expect(result[4]?.provenance.flow).toMatchObject({ kind: 'forecast', source: 'nwps' });
    expect(result[4]?.values.gaugeHeight).toBeNull();
  });

  it('always takes water temperature from the latest observation', () => {
    expect(result.every((h) => h.values.waterTemp === 9.5)).toBe(true);
  });

  it('treats a gap inside the forecast as missing', () => {
    const gappy = riverHours(hours, [forecastPoint(t(1), 120), forecastPoint(t(3), 130)], latest);
    expect(gappy[2]?.values.flow).toBeNull();
    expect(gappy[2]?.provenance.flow?.kind).toBe('forecast');
  });

  it('uses the observation for gauge height when the forecast only covers flow', () => {
    const flowOnly = riverHours(hours, [forecastPoint(t(1), 120)], latest);
    expect(flowOnly[2]?.values.gaugeHeight).toBe(2.5);
    expect(flowOnly[2]?.provenance.gaugeHeight?.kind).toBe('observation');
    expect(flowOnly[3]?.values.gaugeHeight).toBeNull();
    expect(flowOnly[3]?.provenance.gaugeHeight?.withheld).toBe('noForecast');
  });

  it('withholds hours before a late-starting forecast once the reading is 3 hours old', () => {
    const late = riverHours(hours, [forecastPoint(t(4), 130)], [observed('flow', 143, t(0))]);
    expect(late[2]?.values.flow).toBe(143);
    expect(late[3]?.values.flow).toBeNull();
    expect(late[3]?.provenance.flow?.withheld).toBe('noForecast');
    expect(late[4]?.values.flow).toBe(130);
  });
});

describe('riverHours when the flow forecast disagrees with the latest measurement (#82)', () => {
  // Hourly forecast from 00:00, as NWPS steps are interpolated, against a reading at 00:15.
  const forecast = hours.map((time) => forecastPoint(time, 100, 2.4));
  const at = (flow: number, time = '2026-10-26T00:15:00.000Z') => [
    observed('flow', flow, time),
    observed('gaugeHeight', 2.5, time),
  ];

  it('keeps a forecast within 25% of the measurement', () => {
    for (const flow of [80, 125, 133]) {
      const result = riverHours(hours, forecast, at(flow));
      expect(result.every((h) => h.values.flow === 100)).toBe(true);
    }
  });

  it('sets aside a forecast more than 25% away, without holding the reading (#144)', () => {
    expect(FORECAST_DISAGREEMENT).toBe(0.25);
    for (const flow of [134, 79]) {
      const result = riverHours(hours, forecast, at(flow));
      expect(result.every((h) => h.values.flow === null)).toBe(true);
      expect(result[1]?.provenance.flow).toMatchObject({
        kind: 'observation',
        withheld: 'forecastDisagrees',
      });
    }
  });

  it('checks flow only, so the gauge height forecast stays', () => {
    const result = riverHours(hours, forecast, at(200));
    expect(result.every((h) => h.values.gaugeHeight === 2.4)).toBe(true);
  });

  it('compares against the forecast for the hour the measurement was taken', () => {
    const shifted = hours.map((time, i) => forecastPoint(time, i === 0 ? 100 : 300));
    expect(riverHours(hours, shifted, at(110))[2]?.values.flow).toBe(300);
    const setAside = riverHours(hours, shifted, at(110, t(1)))[2];
    expect(setAside?.values.flow).toBeNull();
    expect(setAside?.provenance.flow?.withheld).toBe('forecastDisagrees');
  });

  it('makes no comparison without a forecast for that hour, or a usable measurement in time', () => {
    const later = hours.slice(1).map((time) => forecastPoint(time, 100));
    expect(riverHours(hours, later, at(200))[2]?.values.flow).toBe(100);
    const old = at(200, '2026-10-25T22:30:00.000Z');
    const earlier = [forecastPoint('2026-10-25T22:00:00.000Z', 100), ...forecast];
    expect(riverHours(hours, earlier, old)[2]?.values.flow).toBe(100);
    const flagged = [{ ...observed('flow', 200, t(0)), qualifiers: ['iceAffected' as const] }];
    expect(riverHours(hours, forecast, flagged)[2]?.values.flow).toBe(100);
    expect(riverHours(hours, forecast, [observed('flow', null, t(0))])[2]?.values.flow).toBe(100);
  });
});
