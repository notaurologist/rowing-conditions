import type { ForecastPoint, Reading } from '@rowing/core';
import { describe, expect, it } from 'vitest';
import { riverHours } from './riverHours.ts';

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
  it('copies the latest observation of each metric to every hour, as an observation', () => {
    const latest = [
      observed('flow', 100, '2026-10-25T23:45:00.000Z'),
      observed('flow', 143, '2026-10-26T00:15:00.000Z'), // the most recent wins
      observed('waterTemp', 9.5, '2026-10-26T00:00:00.000Z'),
    ];
    const result = riverHours(hours, [], latest);
    expect(result).toHaveLength(5);
    for (const h of result) {
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
    expect(flowOnly[3]?.values.gaugeHeight).toBe(2.5);
    expect(flowOnly[3]?.provenance.gaugeHeight?.kind).toBe('observation');
  });
});
