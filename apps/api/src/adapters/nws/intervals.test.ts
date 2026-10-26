import { describe, expect, it } from 'vitest';
import { durationMs, expandToHours, wmoUnit } from './intervals.ts';

const HOUR = 3_600_000;

describe('durationMs', () => {
  it.each([
    ['PT1H', 1],
    ['PT3H', 3],
    ['P1D', 24],
    ['P2DT22H', 70],
    ['P7DT12H', 180],
    ['PT90M', 1.5],
  ])('parses %s as %d hours', (duration, hours) => {
    expect(durationMs(duration)).toBe(hours * HOUR);
  });

  it.each(['', 'P', 'PT', '1H', 'P1W', 'PT-1H', 'P1DT'])('rejects %s', (duration) => {
    expect(durationMs(duration)).toBeNull();
  });
});

describe('expandToHours', () => {
  it('repeats a multi-hour value for every hour it covers', () => {
    expect(
      expandToHours([
        { validTime: '2026-10-25T13:00:00+00:00/PT3H', value: 5 },
        { validTime: '2026-10-25T16:00:00+00:00/PT1H', value: 7 },
      ]),
    ).toEqual(
      new Map([
        ['2026-10-25T13:00:00.000Z', 5],
        ['2026-10-25T14:00:00.000Z', 5],
        ['2026-10-25T15:00:00.000Z', 5],
        ['2026-10-25T16:00:00.000Z', 7],
      ]),
    );
  });

  it('expands a whole day', () => {
    const hours = expandToHours([{ validTime: '2026-10-25T13:00:00+00:00/P1D', value: 0 }]);
    expect(hours.size).toBe(24);
  });

  it('keeps null values as null, and leaves gaps between intervals absent', () => {
    const hours = expandToHours([
      { validTime: '2026-10-25T13:00:00+00:00/PT1H', value: null },
      { validTime: '2026-10-25T15:00:00+00:00/PT1H', value: 9 },
    ]);
    expect(hours.get('2026-10-25T13:00:00.000Z')).toBeNull();
    expect(hours.has('2026-10-25T14:00:00.000Z')).toBe(false);
    expect(hours.get('2026-10-25T15:00:00.000Z')).toBe(9);
  });

  it('normalizes offsets to UTC hours', () => {
    const hours = expandToHours([{ validTime: '2026-10-25T09:00:00-04:00/PT1H', value: 1 }]);
    expect([...hours.keys()]).toEqual(['2026-10-25T13:00:00.000Z']);
  });

  it('skips entries it cannot parse', () => {
    expect(expandToHours([{ validTime: 'garbage', value: 1 }]).size).toBe(0);
    expect(expandToHours([{ validTime: '2026-10-25T13:00:00Z/P1W', value: 1 }]).size).toBe(0);
  });
});

describe('wmoUnit', () => {
  it('maps the WMO codes the grid uses to internal units', () => {
    expect(wmoUnit('wmoUnit:degC')).toBe('degC');
    expect(wmoUnit('wmoUnit:degF')).toBe('degF');
    expect(wmoUnit('wmoUnit:km_h-1')).toBe('km/h');
    expect(wmoUnit('wmoUnit:m_s-1')).toBe('m/s');
    expect(wmoUnit('wmoUnit:percent')).toBe('percent');
    expect(wmoUnit('wmoUnit:degree_(angle)')).toBe('degrees');
  });

  it('returns undefined for codes it does not know, so they are never guessed', () => {
    expect(wmoUnit('wmoUnit:kn')).toBeUndefined();
    expect(wmoUnit(null)).toBeUndefined();
  });
});
