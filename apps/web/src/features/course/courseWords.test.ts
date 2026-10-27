import type { Course, ForecastPoint } from '@rowing/core';
import { describe, expect, it } from 'vitest';
import { courseWindByHour, courseWindWords, legWords } from './courseWords.ts';

const A: [number, number] = [42.6, -72.55];
const B: [number, number] = [42.609, -72.55];
const C: [number, number] = [42.609, -72.5378];
const north: Course = { taps: [A, B], legs: [{ points: [A, B] }] };
const triangle: Course = {
  taps: [A, B, C, A],
  legs: [{ points: [A, B] }, { points: [B, C] }, { points: [C, A], straight: true }],
  loop: true,
};

const hour = (windSpeed: number | null, windDirection: number | null): ForecastPoint => ({
  time: '2026-10-27T18:00:00.000Z',
  values: { windSpeed, windDirection },
  provenance: {
    windSpeed: { kind: 'forecast', asOf: '2026-10-27T15:00:00.000Z', source: 'nws' },
    windDirection: { kind: 'forecast', asOf: '2026-10-27T15:00:00.000Z', source: 'nws' },
  },
});

describe('course wind words (#103, #142)', () => {
  it('lists each kind of wind on a leg, largest share first, leaving out none', () => {
    expect(legWords({ head: 0.4, cross: 0.6, tail: 0 })).toBe('crosswind 60%, headwind 40%');
    expect(legWords({ head: 1, cross: 0, tail: 0 })).toBe('headwind 100%');
  });

  it('gives out and back the same words under the readout and in the table', () => {
    const words = courseWindWords({
      state: 'wind',
      kind: 'outAndBack',
      out: { head: 1, cross: 0, tail: 0 },
      back: { head: 0, cross: 0, tail: 1 },
    });
    expect(words).toEqual({
      summary: 'Out: headwind 100%. Back: tailwind 100%.',
      detail: 'Out: headwind 100%. Back: tailwind 100%.',
    });
  });

  it('gives a loop as a whole under the readout, and each leg in the table', () => {
    const words = courseWindWords({
      state: 'wind',
      kind: 'loop',
      whole: { head: 0.3, cross: 0.3, tail: 0.4 },
      legs: [
        { head: 1, cross: 0, tail: 0 },
        { head: 0, cross: 1, tail: 0 },
        { head: 0, cross: 0, tail: 1 },
      ],
    });
    expect(words.summary).toBe('Loop: tailwind 40%, headwind 30%, crosswind 30%.');
    expect(words.detail).toBe(
      'Loop: tailwind 40%, headwind 30%, crosswind 30%. Leg 1: headwind 100%. Leg 2: crosswind 100%. Leg 3: tailwind 100%.',
    );
  });

  it('says when it is calm or unknown', () => {
    expect(courseWindWords({ state: 'calm' }).summary).toBe('Calm on the course');
    expect(courseWindWords({ state: 'unknown' }).detail).toBe('Course wind unknown');
  });

  it('words each hour from its wind speed and direction', () => {
    expect(
      courseWindByHour(north, [hour(4, 0), hour(0, 90), hour(4, null)]).map((w) => w.summary),
    ).toEqual([
      'Out: headwind 100%. Back: tailwind 100%.',
      'Calm on the course',
      'Course wind unknown',
    ]);
    expect(courseWindByHour(triangle, [hour(4, 0)])[0]?.detail).toMatch(
      /^Loop: .*\. Leg 1: headwind 100%\. Leg 2: crosswind 100%\. Leg 3: tailwind 100%\.$/,
    );
  });
});
