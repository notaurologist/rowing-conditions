import { describe, expect, it } from 'vitest';
import { ConditionsResponse } from '../types/conditions.ts';
import type { Qualifier } from '../types/measurement.ts';
import type { Reading } from '../types/readings.ts';
import { Trend, trendOf } from './trend.ts';

const LATEST = Date.parse('2026-10-27T15:00:00.000Z');
const MINUTE = 60_000;

// A reading `minutesAgo` before the latest.
function reading(
  metric: Reading['metric'],
  minutesAgo: number,
  value: number | null,
  qualifiers?: Qualifier[],
): Reading {
  return {
    metric,
    value,
    observedAt: new Date(LATEST - minutesAgo * MINUTE).toISOString(),
    fetchedAt: new Date(LATEST).toISOString(),
    source: 'usgs',
    ...(qualifiers ? { qualifiers } : {}),
  };
}

// Readings every 15 minutes for the last 3 hours, from `start` to `end`, linear between.
function series(metric: 'flow' | 'gaugeHeight', start: number, end: number): Reading[] {
  return Array.from({ length: 13 }, (_, i) =>
    reading(metric, 180 - i * 15, start + ((end - start) * i) / 12),
  );
}

const at = (minutesAgo: number) => new Date(LATEST - minutesAgo * MINUTE).toISOString();

describe('trendOf: direction and rate', () => {
  it('measures flow rising over the last 3 hours', () => {
    expect(trendOf('flow', series('flow', 100, 130))).toEqual({
      metric: 'flow',
      direction: 'rising',
      ratePerHour: 10,
      from: at(180),
      to: at(0),
    });
  });

  it('measures flow falling, with a negative rate', () => {
    expect(trendOf('flow', series('flow', 130, 100))).toMatchObject({
      direction: 'falling',
      ratePerHour: -10,
    });
  });

  it('calls flow stable below 2% of the starting flow per hour', () => {
    // From 100 m³/s, 2% per hour is 2 m³/s per hour, or 6 over 3 hours.
    expect(trendOf('flow', series('flow', 100, 105.9))).toMatchObject({ direction: 'stable' });
    expect(trendOf('flow', series('flow', 100, 94.1))).toMatchObject({ direction: 'stable' });
  });

  it('calls flow rising or falling at 2% of the starting flow per hour', () => {
    expect(trendOf('flow', series('flow', 100, 106))).toMatchObject({ direction: 'rising' });
    expect(trendOf('flow', series('flow', 100, 94))).toMatchObject({ direction: 'falling' });
  });

  it('scales the flow cutoff with the river', () => {
    // The same 3 m³/s per hour is stable on a big river and rising on a small one.
    expect(trendOf('flow', series('flow', 1000, 1009))).toMatchObject({ direction: 'stable' });
    expect(trendOf('flow', series('flow', 10, 19))).toMatchObject({ direction: 'rising' });
  });

  it('calls flow that starts at zero stable only if it stays at zero', () => {
    expect(trendOf('flow', series('flow', 0, 0))).toMatchObject({
      direction: 'stable',
      ratePerHour: 0,
    });
    expect(trendOf('flow', series('flow', 0, 0.3))).toMatchObject({ direction: 'rising' });
  });

  it('calls gauge height stable below 0.01 m per hour', () => {
    expect(trendOf('gaugeHeight', series('gaugeHeight', 2, 2.029))).toMatchObject({
      direction: 'stable',
    });
    expect(trendOf('gaugeHeight', series('gaugeHeight', 2, 1.971))).toMatchObject({
      direction: 'stable',
    });
  });

  it('calls gauge height rising or falling from 0.01 m per hour', () => {
    expect(trendOf('gaugeHeight', series('gaugeHeight', 2, 2.031))).toMatchObject({
      direction: 'rising',
    });
    expect(trendOf('gaugeHeight', series('gaugeHeight', 2, 1.969))).toMatchObject({
      direction: 'falling',
    });
  });

  it('uses an absolute cutoff for gauge height, which can be negative', () => {
    expect(trendOf('gaugeHeight', series('gaugeHeight', -0.5, -0.4))).toMatchObject({
      direction: 'rising',
    });
  });

  it('keeps the rate of a stable trend', () => {
    const trend = trendOf('flow', series('flow', 100, 103));
    expect(trend).toMatchObject({ direction: 'stable' });
    expect(trend.direction !== 'unknown' && trend.ratePerHour).toBeCloseTo(1);
  });
});

describe('trendOf: which readings', () => {
  it('measures between the endpoints only, ignoring readings between them', () => {
    const readings = [reading('flow', 180, 100), reading('flow', 90, 500), reading('flow', 0, 130)];
    expect(trendOf('flow', readings)).toMatchObject({ direction: 'rising', ratePerHour: 10 });
  });

  it('ignores readings older than 3 hours before the latest', () => {
    const readings = [reading('flow', 240, 10), ...series('flow', 100, 130)];
    expect(trendOf('flow', readings)).toMatchObject({ ratePerHour: 10, from: at(180) });
  });

  it('accepts readings in any order', () => {
    expect(trendOf('flow', series('flow', 100, 130).reverse())).toMatchObject({
      ratePerHour: 10,
      to: at(0),
    });
  });

  it('ignores readings of other metrics', () => {
    const readings = [...series('flow', 100, 130), ...series('gaugeHeight', 5, 1)];
    expect(trendOf('flow', readings)).toMatchObject({ direction: 'rising', ratePerHour: 10 });
    expect(trendOf('gaugeHeight', readings)).toMatchObject({ direction: 'falling' });
  });

  it('skips readings without a value', () => {
    const readings = [...series('flow', 100, 130), reading('flow', -15, null)];
    expect(trendOf('flow', readings)).toMatchObject({ ratePerHour: 10, to: at(0) });
  });

  it('skips readings with a qualifier that makes them unreliable', () => {
    const readings = [
      reading('flow', 180, 100),
      reading('flow', 0, 130),
      reading('flow', -15, 900, ['iceAffected']),
    ];
    expect(trendOf('flow', readings)).toMatchObject({ ratePerHour: 10, to: at(0) });
  });

  it('keeps provisional readings', () => {
    const readings = [reading('flow', 180, 100, ['provisional']), reading('flow', 0, 130)];
    expect(trendOf('flow', readings)).toMatchObject({ direction: 'rising' });
  });

  it('measures from 2 hours back when that is the earliest reading in the window', () => {
    const readings = [reading('flow', 120, 100), reading('flow', 0, 120)];
    expect(trendOf('flow', readings)).toMatchObject({ ratePerHour: 10, from: at(120) });
  });
});

describe('trendOf: unknown, never stable, when history is missing', () => {
  it('is unknown with no readings', () => {
    expect(trendOf('flow', [])).toEqual({
      metric: 'flow',
      direction: 'unknown',
      reason: 'noReadings',
    });
  });

  it('is unknown when no reading has a usable value', () => {
    const readings = [reading('flow', 180, null), reading('flow', 0, 100, ['estimated'])];
    expect(trendOf('flow', readings)).toMatchObject({ direction: 'unknown', reason: 'noReadings' });
  });

  it('is unknown with a single reading', () => {
    expect(trendOf('flow', [reading('flow', 0, 100)])).toMatchObject({
      direction: 'unknown',
      reason: 'shortHistory',
    });
  });

  it('is unknown when the earliest reading in the window is under 2 hours back', () => {
    const readings = [reading('flow', 119, 100), reading('flow', 0, 100)];
    expect(trendOf('flow', readings)).toMatchObject({
      direction: 'unknown',
      reason: 'shortHistory',
    });
  });

  it('is unknown when the only earlier readings are more than 3 hours back', () => {
    const readings = [reading('flow', 181, 100), reading('flow', 0, 100)];
    expect(trendOf('flow', readings)).toMatchObject({
      direction: 'unknown',
      reason: 'shortHistory',
    });
  });

  it('is unknown when the reading 3 hours back has no usable value', () => {
    const readings = [
      reading('flow', 180, null),
      reading('flow', 150, 100, ['equipmentMalfunction']),
      reading('flow', 60, 100),
      reading('flow', 0, 100),
    ];
    expect(trendOf('flow', readings)).toMatchObject({ direction: 'unknown' });
  });
});

describe('Trend schema', () => {
  it('accepts what trendOf returns', () => {
    expect(Trend.parse(trendOf('flow', series('flow', 100, 130)))).toBeTruthy();
    expect(Trend.parse(trendOf('flow', []))).toBeTruthy();
  });

  it('requires a rate and its readings for a known direction, and a reason for unknown', () => {
    expect(Trend.safeParse({ metric: 'flow', direction: 'rising' }).success).toBe(false);
    expect(Trend.safeParse({ metric: 'flow', direction: 'unknown' }).success).toBe(false);
  });
});

describe('ConditionsResponse trends', () => {
  it('defaults to none, so a copy saved before trends were added still parses', () => {
    const saved = {
      location: { lat: 42.6, lon: -72.55, timezone: null },
      current: [],
      forecast: [],
      flowSeries: [],
      daylight: [],
      alerts: [],
      sources: [],
    };
    expect(ConditionsResponse.parse(saved).trends).toEqual([]);
  });
});
