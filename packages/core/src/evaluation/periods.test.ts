import { describe, expect, it } from 'vitest';
import { civilDaylightSpan, daylightWindowSpan } from '../daylight/daylight.ts';
import type { EvaluationStatus, Failure, HourResult } from '../types/evaluation.ts';
import type { RuleSet } from '../types/rules.ts';
import { findPeriods, nextWindow, type Period } from './periods.ts';

const lat = 42.6;
const lon = -72.55;
const HOUR = 3_600_000;
// 14:00Z on April 15 is 10 AM in Turners Falls; civil dusk is about 00:00Z.
const DAY = '2026-04-15T14:00:00.000Z';
const at = (iso: string, hours = 0) => new Date(Date.parse(iso) + hours * HOUR).toISOString();

const ruleSet: RuleSet = {
  id: 'rs',
  name: 'Club A',
  boatClasses: [{ id: 'small', name: '1x' }],
  thresholds: [
    {
      id: 'flow',
      metric: 'flow',
      comparison: 'max',
      boundary: 'inclusive',
      value: 87.78,
      enteredUnit: 'cfs',
    },
    {
      id: 'water',
      metric: 'waterTemp',
      comparison: 'min',
      boundary: 'inclusive',
      value: 10,
      enteredUnit: 'degC',
    },
  ],
};
const ctx = { ruleSet, lat, lon };

function hour(time: string, status: EvaluationStatus, extra: Partial<HourResult> = {}): HourResult {
  return { time, status, light: 'daylight', failures: [], unknowns: [], ...extra };
}

const flowFailure = (value: number): Failure => ({
  kind: 'limit',
  thresholdId: 'flow',
  metric: 'flow',
  value,
  limit: 3100,
  unit: 'cfs',
});

describe('findPeriods', () => {
  it('groups consecutive rowing hours with the same status', () => {
    const hours = [
      hour(at(DAY, 0), 'within'),
      hour(at(DAY, 1), 'within'),
      hour(at(DAY, 2), 'outside', { failures: [flowFailure(3200)] }),
      hour(at(DAY, 3), 'outside', { failures: [flowFailure(3300)] }),
      hour(at(DAY, 4), 'unknown', {
        unknowns: [{ thresholdId: 'water', metric: 'waterTemp', reason: 'stale' }],
      }),
    ];
    expect(findPeriods(hours, ctx).map((p) => [p.status, p.start, p.end])).toEqual([
      ['within', at(DAY, 0), at(DAY, 2)],
      ['outside', at(DAY, 2), at(DAY, 4)],
      ['unknown', at(DAY, 4), at(DAY, 5)],
    ]);
  });

  it('leaves out hours between civil dusk and civil dawn, splitting days', () => {
    // 02:00Z to 08:00Z on April 16 is 10 PM to 4 AM local: dark.
    const hours = Array.from({ length: 30 }, (_, i) => hour(at(DAY, i), 'within'));
    const periods = findPeriods(hours, ctx);
    expect(periods).toHaveLength(2);
    expect(periods[0]?.start).toBe(at(DAY, 0));
    expect(Date.parse(periods[0]?.end ?? '')).toBeLessThanOrEqual(
      Date.parse('2026-04-16T01:00:00Z'),
    );
    expect(Date.parse(periods[1]?.start ?? '')).toBeGreaterThanOrEqual(
      Date.parse('2026-04-16T09:00:00Z'),
    );
  });

  it('cuts periods at civil dawn and dusk to the minute, of any status', () => {
    // 23:00Z to 01:00Z on April 15 spans civil dusk (about 00:10Z).
    const evening = '2026-04-15T23:00:00.000Z';
    const span = civilDaylightSpan(evening, lat, lon);
    const periods = findPeriods(
      [
        hour(evening, 'outside', { failures: [flowFailure(3200)] }),
        hour(at(evening, 1), 'outside', { failures: [flowFailure(3200)] }),
      ],
      ctx,
    );
    expect(span.kind).toBe('span');
    if (span.kind !== 'span') return;
    expect(periods[0]?.start).toBe(evening);
    expect(periods[0]?.end).toBe(
      new Date(Math.floor(Date.parse(span.end) / 60_000) * 60_000).toISOString(),
    );
    expect(Date.parse(periods[0]?.end ?? '')).toBeLessThan(Date.parse(at(evening, 2)));
  });

  it('splits at a gap in the timeline', () => {
    const hours = [hour(at(DAY, 0), 'within'), hour(at(DAY, 2), 'within')];
    expect(findPeriods(hours, ctx)).toHaveLength(2);
  });

  it('gives the worst value against each limit that failed', () => {
    const hours = [
      hour(at(DAY, 0), 'outside', {
        failures: [
          flowFailure(3200),
          {
            kind: 'limit',
            thresholdId: 'water',
            metric: 'waterTemp',
            value: 9.5,
            limit: 10,
            unit: 'degC',
          },
        ],
      }),
      hour(at(DAY, 1), 'outside', {
        failures: [
          flowFailure(3300),
          {
            kind: 'limit',
            thresholdId: 'water',
            metric: 'waterTemp',
            value: 8.9,
            limit: 10,
            unit: 'degC',
          },
        ],
      }),
      hour(at(DAY, 2), 'outside', { failures: [flowFailure(3150)] }),
    ];
    expect(findPeriods(hours, ctx)[0]?.reasons).toEqual([
      {
        kind: 'limit',
        thresholdId: 'flow',
        metric: 'flow',
        comparison: 'max',
        boundary: 'inclusive',
        worst: 3300,
        limit: 3100,
        unit: 'cfs',
        hours: 3,
      },
      {
        kind: 'limit',
        thresholdId: 'water',
        metric: 'waterTemp',
        comparison: 'min',
        boundary: 'inclusive',
        worst: 8.9,
        limit: 10,
        unit: 'degC',
        hours: 2,
      },
    ]);
  });

  it('lists each unknown metric and reason once, also for outside periods', () => {
    const stale = { thresholdId: 'water', metric: 'waterTemp' as const, reason: 'stale' as const };
    const hours = [
      hour(at(DAY, 0), 'outside', { failures: [flowFailure(3200)], unknowns: [stale] }),
      hour(at(DAY, 1), 'outside', { failures: [flowFailure(3200)], unknowns: [stale] }),
    ];
    expect(findPeriods(hours, ctx)[0]?.reasons).toContainEqual({
      kind: 'unknown',
      metric: 'waterTemp',
      reason: 'stale',
      hours: 2,
    });
  });

  it('has no reasons for a within period', () => {
    expect(findPeriods([hour(at(DAY, 0), 'within')], ctx)[0]?.reasons).toEqual([]);
  });

  it('cuts within periods at the edges of a daylight window', () => {
    const withWindow = {
      ...ctx,
      ruleSet: { ...ruleSet, daylight: { minutesBeforeSunrise: 0, minutesAfterSunset: 0 } },
    };
    // Sunrise on April 16 is about 10:06Z; hours from 09:00Z.
    const start = '2026-04-16T09:00:00.000Z';
    const span = daylightWindowSpan(at(start, 1), lat, lon, withWindow.ruleSet.daylight);
    const hours = [
      hour(at(start, 0), 'outside', { failures: [{ kind: 'daylight' }] }),
      hour(at(start, 1), 'within'),
      hour(at(start, 2), 'within'),
    ];
    const periods = findPeriods(hours, withWindow);
    // The hour entirely before the window isn't a rowing hour, and the within period starts at sunrise.
    expect(periods).toHaveLength(1);
    expect(span.kind).toBe('span');
    if (span.kind === 'span') {
      expect(Date.parse(periods[0]?.start ?? '')).toBeGreaterThanOrEqual(Date.parse(span.start));
    }
    expect(periods[0]?.end).toBe(at(start, 3));
  });

  it('returns nothing for an empty timeline', () => {
    expect(findPeriods([], ctx)).toEqual([]);
  });
});

describe('nextWindow', () => {
  const p = (status: EvaluationStatus, from: number, to: number): Period => ({
    status,
    start: at(DAY, from),
    end: at(DAY, to),
    reasons: [],
  });

  it('skips later within periods when finding what follows', () => {
    // Today's window ends at dusk; tomorrow starts within, then turns outside.
    const periods = [p('within', 0, 3), p('within', 20, 22), p('outside', 22, 24)];
    expect(nextWindow(periods, at(DAY, 0))?.following).toBe(periods[2]);
  });

  it('finds the first within period not yet over, and the period after it', () => {
    const periods = [p('outside', 0, 2), p('within', 2, 5), p('unknown', 5, 6), p('within', 6, 8)];
    expect(nextWindow(periods, at(DAY, 1))).toEqual({
      window: periods[1],
      following: periods[2],
      before: periods[0],
    });
  });

  it('counts a window that has started as the next one', () => {
    const periods = [p('within', 0, 3), p('outside', 3, 4)];
    expect(nextWindow(periods, at(DAY, 1))).toEqual({ window: periods[0], following: periods[1] });
  });

  it('has no following period when the window runs to the end', () => {
    expect(nextWindow([p('within', 0, 3)], at(DAY, 0))).toEqual({ window: p('within', 0, 3) });
  });

  it('returns null when no window is left', () => {
    expect(nextWindow([p('within', 0, 2), p('outside', 2, 4)], at(DAY, 3))).toBeNull();
  });
});

describe('probably within (decision 0020)', () => {
  const doubted = (time: string) =>
    hour(time, 'probablyWithin', {
      doubtful: [{ thresholdId: 'flow', metric: 'flow', reason: 'forecastDisagrees' }],
    });

  it('groups probable hours into their own periods, saying what is doubted', () => {
    const hours = [
      hour(at(DAY, 0), 'within'),
      doubted(at(DAY, 1)),
      doubted(at(DAY, 2)),
      hour(at(DAY, 3), 'within'),
    ];
    const periods = findPeriods(hours, ctx);
    expect(periods.map((p) => p.status)).toEqual(['within', 'probablyWithin', 'within']);
    expect(periods[1]?.reasons).toEqual([
      { kind: 'doubtful', metric: 'flow', reason: 'forecastDisagrees', hours: 2 },
    ]);
  });

  it('finds the next probable window only when asked for one', () => {
    const p = (status: EvaluationStatus, from: number, to: number): Period => ({
      status,
      start: at(DAY, from),
      end: at(DAY, to),
      reasons: [],
    });
    const periods = [p('unknown', 0, 2), p('probablyWithin', 2, 5), p('outside', 5, 6)];
    expect(nextWindow(periods, at(DAY, 0))).toBeNull();
    expect(nextWindow(periods, at(DAY, 0), 'probablyWithin')).toEqual({
      window: periods[1],
      before: periods[0],
      following: periods[2],
    });
  });
});
