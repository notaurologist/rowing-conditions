import { describe, expect, it } from 'vitest';
import { ForecastPoint, Reading } from './readings.ts';

const reading = {
  metric: 'flow',
  value: 425.5,
  observedAt: '2026-10-25T14:15:00Z',
  fetchedAt: '2026-10-25T14:20:00Z',
  source: 'usgs',
  sourceRef: 'USGS-01170500',
  qualifiers: ['provisional'],
};

const point = {
  time: '2026-10-25T15:00:00Z',
  values: { flow: 430.1, windSpeed: 4.2, windGust: null },
  provenance: {
    flow: { kind: 'forecast', asOf: '2026-10-25T12:00:00Z', source: 'nwps', interpolated: true },
    windSpeed: { kind: 'forecast', asOf: '2026-10-25T13:05:00Z', source: 'nws' },
    windGust: { kind: 'forecast', asOf: '2026-10-25T13:05:00Z', source: 'nws' },
  },
};

describe('Reading', () => {
  it('accepts a reading with qualifiers', () => {
    expect(Reading.safeParse(reading).success).toBe(true);
  });

  it('accepts a null value, meaning the source reported none', () => {
    expect(Reading.safeParse({ ...reading, value: null }).success).toBe(true);
  });

  it('requires UTC times written with Z', () => {
    expect(Reading.safeParse({ ...reading, observedAt: '2026-10-25T10:15:00-04:00' }).success).toBe(
      false,
    );
    expect(Reading.safeParse({ ...reading, fetchedAt: 'yesterday' }).success).toBe(false);
  });

  it('rejects an unknown qualifier or source', () => {
    expect(Reading.safeParse({ ...reading, qualifiers: ['ice'] }).success).toBe(false);
    expect(Reading.safeParse({ ...reading, source: 'wunderground' }).success).toBe(false);
  });

  it('rejects values outside the range their SI unit allows', () => {
    const cases: [string, number][] = [
      ['flow', -1],
      ['windSpeed', -0.1],
      ['windGust', -3],
      ['precipChance', 40],
      ['precipChance', -0.1],
      ['windDirection', 360],
      ['windDirection', -10],
    ];
    for (const [metric, value] of cases) {
      expect(Reading.safeParse({ ...reading, metric, value }).success, `${metric} ${value}`).toBe(
        false,
      );
    }
  });

  it('accepts negative flow only when marked as reversed (#116)', () => {
    const reversed = { ...reading, value: -45.9, qualifiers: ['provisional', 'reversedFlow'] };
    expect(Reading.safeParse(reversed).success).toBe(true);
    expect(Reading.safeParse({ ...reversed, qualifiers: ['provisional'] }).success).toBe(false);
    expect(Reading.safeParse({ ...reversed, metric: 'windSpeed' }).success).toBe(false);
  });

  it('accepts negative temperatures and gauge heights', () => {
    expect(Reading.safeParse({ ...reading, metric: 'airTemp', value: -12 }).success).toBe(true);
    expect(Reading.safeParse({ ...reading, metric: 'gaugeHeight', value: -0.3 }).success).toBe(
      true,
    );
  });
});

describe('ForecastPoint', () => {
  it('accepts a point with values, nulls, and provenance', () => {
    expect(ForecastPoint.safeParse(point).success).toBe(true);
  });

  it('requires the time to be the start of an hour', () => {
    expect(ForecastPoint.safeParse({ ...point, time: '2026-10-25T15:30:00Z' }).success).toBe(false);
  });

  it('rejects out-of-range values', () => {
    const values = { ...point.values, flow: -5 };
    expect(ForecastPoint.safeParse({ ...point, values }).success).toBe(false);
  });

  it('accepts a negative flow whose provenance marks it as reversed', () => {
    const values = { ...point.values, flow: -5 };
    const provenance = {
      ...point.provenance,
      flow: {
        kind: 'observation',
        asOf: '2026-10-25T14:15:00Z',
        source: 'usgs',
        qualifiers: ['reversedFlow'],
      },
    };
    expect(ForecastPoint.safeParse({ ...point, values, provenance }).success).toBe(true);
  });

  it('rejects a value without provenance, since its source and age would be unknown', () => {
    const values = { ...point.values, airTemp: 8 };
    expect(ForecastPoint.safeParse({ ...point, values }).success).toBe(false);
  });
});
