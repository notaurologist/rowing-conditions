import { describe, expect, it } from 'vitest';
import { daylightWindowSpan } from '../daylight/daylight.ts';
import type { EvaluationStatus, HourResult } from '../types/evaluation.ts';
import type { RuleSet } from '../types/rules.ts';
import { findWindows } from './windows.ts';

const lat = 42.6;
const lon = -72.55;
const HOUR = 3_600_000;
const MINUTE = 60_000;

const at = (iso: string, hours = 0) => new Date(Date.parse(iso) + hours * HOUR).toISOString();

function hours(start: string, statuses: EvaluationStatus[]): HourResult[] {
  return statuses.map((status, i) => ({
    time: at(start, i),
    status,
    light: 'daylight',
    failures: status === 'outside' ? [{ kind: 'daylight' }] : [],
    unknowns: [],
  }));
}

const ruleSet = (daylight?: RuleSet['daylight']): RuleSet => ({
  id: 'rs',
  name: 'Club A rules',
  boatClasses: [{ id: 'small', name: '1x' }],
  thresholds: [],
  ...(daylight ? { daylight } : {}),
});

const noWindow = { ruleSet: ruleSet(), lat, lon };

describe('findWindows without a daylight window', () => {
  it('turns a run of within hours into one window ending an hour after the last', () => {
    const h = hours('2026-04-15T14:00:00Z', ['within', 'within', 'within']);
    expect(findWindows(h, noWindow)).toEqual([
      { start: '2026-04-15T14:00:00.000Z', end: '2026-04-15T17:00:00.000Z' },
    ]);
  });

  it('splits runs at outside and unknown hours', () => {
    const h = hours('2026-04-15T12:00:00Z', [
      'within',
      'outside',
      'within',
      'within',
      'unknown',
      'within',
    ]);
    expect(findWindows(h, noWindow)).toEqual([
      { start: at('2026-04-15T12:00:00Z'), end: at('2026-04-15T12:00:00Z', 1) },
      { start: at('2026-04-15T12:00:00Z', 2), end: at('2026-04-15T12:00:00Z', 4) },
      { start: at('2026-04-15T12:00:00Z', 5), end: at('2026-04-15T12:00:00Z', 6) },
    ]);
  });

  it('splits runs where an hour is missing from the timeline', () => {
    const [a, b, , d] = hours('2026-04-15T12:00:00Z', ['within', 'within', 'within', 'within']);
    expect(findWindows([a, b, d] as HourResult[], noWindow)).toHaveLength(2);
  });

  it('finds no windows when every hour is outside or unknown, or there are no hours', () => {
    expect(findWindows(hours('2026-04-15T12:00:00Z', ['outside', 'unknown']), noWindow)).toEqual(
      [],
    );
    expect(findWindows([], noWindow)).toEqual([]);
  });

  it('does not depend on the order hours are given in', () => {
    const h = hours('2026-04-15T14:00:00Z', ['within', 'within', 'outside', 'within']);
    expect(findWindows([...h].reverse(), noWindow)).toEqual(findWindows(h, noWindow));
  });
});

describe('findWindows with a daylight window', () => {
  const window = { minutesBeforeSunrise: 60, minutesAfterSunset: 30 };
  const withWindow = { ruleSet: ruleSet(window), lat, lon };
  const span = daylightWindowSpan('2026-04-15T16:00:00Z', lat, lon, window);
  if (span.kind !== 'span') throw new Error('expected a span');
  const opens = Date.parse(span.start);
  const closes = Date.parse(span.end);
  const hourOf = (ms: number) => Math.floor(ms / HOUR) * HOUR;

  it('trims a window to the minute the daylight window opens and closes', () => {
    // From the hour containing the opening to the hour containing the closing, all within.
    const first = hourOf(opens);
    const count = (hourOf(closes) - first) / HOUR + 1;
    const h = hours(new Date(first).toISOString(), Array(count).fill('within'));
    const [w] = findWindows(h, withWindow);
    expect(w).toBeDefined();
    // Cut inward to whole minutes: never earlier than the opening, never later than the closing.
    expect(w?.start).toBe(new Date(Math.ceil(opens / MINUTE) * MINUTE).toISOString());
    expect(w?.end).toBe(new Date(Math.floor(closes / MINUTE) * MINUTE).toISOString());
  });

  it('leaves a window inside the daylight window untouched', () => {
    const h = hours('2026-04-15T15:00:00Z', ['within', 'within']);
    expect(findWindows(h, withWindow)).toEqual([
      { start: '2026-04-15T15:00:00.000Z', end: '2026-04-15T17:00:00.000Z' },
    ]);
  });

  it('trims each day separately across two days', () => {
    const day2 = daylightWindowSpan('2026-04-16T16:00:00Z', lat, lon, window);
    if (day2.kind !== 'span') throw new Error('expected a span');
    const eveningHour = hourOf(closes);
    const morningHour = hourOf(Date.parse(day2.start));
    const h = [
      ...hours(new Date(eveningHour).toISOString(), ['within']),
      ...hours(new Date(morningHour).toISOString(), ['within']),
    ];
    const windows = findWindows(h, withWindow);
    expect(windows).toHaveLength(2);
    expect(windows[0]?.end).toBe(new Date(Math.floor(closes / MINUTE) * MINUTE).toISOString());
    const day2Opens = Date.parse(day2.start);
    expect(windows[1]?.start).toBe(new Date(Math.ceil(day2Opens / MINUTE) * MINUTE).toISOString());
  });

  it('drops a window that trimming leaves empty', () => {
    // Choose the offset so the daylight window opens in the last minute of an hour. Cut to the
    // whole minute, the window then starts exactly when that hour ends.
    const sunrise = daylightWindowSpan('2026-04-15T16:00:00Z', lat, lon, {
      minutesBeforeSunrise: 0,
      minutesAfterSunset: 0,
    });
    if (sunrise.kind !== 'span') throw new Error('expected a span');
    const hourEnd = hourOf(Date.parse(sunrise.start)) - HOUR;
    const minutesBeforeSunrise = Math.ceil((Date.parse(sunrise.start) - hourEnd) / MINUTE);
    const late = { ruleSet: ruleSet({ minutesBeforeSunrise, minutesAfterSunset: 0 }), lat, lon };
    const h = hours(new Date(hourEnd - HOUR).toISOString(), ['within']);
    expect(findWindows(h, late)).toEqual([]);
  });

  it('trims the end of a run against the daylight window of its last hour', () => {
    // A 12-hour offset each side makes the window cover the night, so a run can cross into
    // the next solar day. Its end must be cut by that day's window, not the first day's.
    const long = { minutesBeforeSunrise: 720, minutesAfterSunset: 720 };
    const ctx = { ruleSet: ruleSet(long), lat, lon };
    const h = hours('2026-04-15T12:00:00Z', Array(30).fill('within'));
    const windows = findWindows(h, ctx);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.end).toBe(at('2026-04-15T12:00:00Z', 30));
  });

  it('does not trim during polar day', () => {
    const polar = { ruleSet: ruleSet(window), lat: 71.29, lon: -156.79 };
    const h = hours('2026-06-21T10:00:00Z', ['within', 'within']);
    expect(findWindows(h, polar)).toEqual([
      { start: '2026-06-21T10:00:00.000Z', end: '2026-06-21T12:00:00.000Z' },
    ]);
  });
});
