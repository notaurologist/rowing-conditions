import type { Course, ForecastPoint } from '@rowing/core';
import { describe, expect, it } from 'vitest';
import { courseWindByHour, courseWindWords, legWords } from './courseWords.ts';

const north: Course = {
  points: [
    [42.6, -72.55],
    [42.609, -72.55],
  ],
};
const hour = (windSpeed: number | null, windDirection: number | null): ForecastPoint => ({
  time: '2026-10-27T18:00:00.000Z',
  values: { windSpeed, windDirection },
  provenance: {
    windSpeed: { kind: 'forecast', asOf: '2026-10-27T15:00:00.000Z', source: 'nws' },
    windDirection: { kind: 'forecast', asOf: '2026-10-27T15:00:00.000Z', source: 'nws' },
  },
});

describe('course wind words (#103)', () => {
  it('lists each kind of wind on a leg, largest share first, leaving out none', () => {
    expect(legWords({ head: 0.4, cross: 0.6, tail: 0 })).toBe('crosswind 60%, headwind 40%');
    expect(legWords({ head: 1, cross: 0, tail: 0 })).toBe('headwind 100%');
  });

  it('describes both legs, and says when it is calm or unknown', () => {
    expect(
      courseWindWords({
        state: 'wind',
        out: { head: 1, cross: 0, tail: 0 },
        back: { head: 0, cross: 0, tail: 1 },
      }),
    ).toBe('Out: headwind 100%. Back: tailwind 100%.');
    expect(courseWindWords({ state: 'calm' })).toBe('Calm on the course');
    expect(courseWindWords({ state: 'unknown' })).toBe('Course wind unknown');
  });

  it('words each hour from its wind speed and direction', () => {
    expect(courseWindByHour(north, [hour(4, 0), hour(0, 90), hour(4, null)])).toEqual([
      'Out: headwind 100%. Back: tailwind 100%.',
      'Calm on the course',
      'Course wind unknown',
    ]);
  });
});
