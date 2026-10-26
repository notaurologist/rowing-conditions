import { describe, expect, it } from 'vitest';
import { interpolateHourly } from './interpolate.ts';

const t = (hour: number) => new Date(Date.UTC(2026, 9, 26, hour)).toISOString();

describe('interpolateHourly', () => {
  it('fills the hours between 6-hourly steps linearly and marks them interpolated', () => {
    const result = interpolateHourly([
      { time: t(0), value: 100 },
      { time: t(6), value: 160 },
    ]);
    expect(result).toEqual([
      { time: t(0), value: 100, interpolated: false },
      { time: t(1), value: 110, interpolated: true },
      { time: t(2), value: 120, interpolated: true },
      { time: t(3), value: 130, interpolated: true },
      { time: t(4), value: 140, interpolated: true },
      { time: t(5), value: 150, interpolated: true },
      { time: t(6), value: 160, interpolated: false },
    ]);
  });

  it('starts at the first whole hour and stops at the last, for steps off the hour', () => {
    const result = interpolateHourly([
      { time: '2026-10-26T00:30:00.000Z', value: 0 },
      { time: '2026-10-26T02:30:00.000Z', value: 20 },
    ]);
    expect(result).toEqual([
      { time: t(1), value: 5, interpolated: true },
      { time: t(2), value: 15, interpolated: true },
    ]);
  });

  it('is null between steps where either side is null', () => {
    const result = interpolateHourly([
      { time: t(0), value: 100 },
      { time: t(2), value: null },
      { time: t(4), value: 140 },
    ]);
    expect(result.map((p) => p.value)).toEqual([100, null, null, null, 140]);
  });

  it('never extrapolates past the first or last step', () => {
    const result = interpolateHourly([
      { time: t(6), value: 1 },
      { time: t(12), value: 2 },
    ]);
    expect(result[0]?.time).toBe(t(6));
    expect(result.at(-1)?.time).toBe(t(12));
  });

  it('handles unsorted input and a single step', () => {
    expect(
      interpolateHourly([
        { time: t(2), value: 20 },
        { time: t(0), value: 0 },
      ]).map((p) => p.value),
    ).toEqual([0, 10, 20]);
    expect(interpolateHourly([{ time: t(3), value: 7 }])).toEqual([
      { time: t(3), value: 7, interpolated: false },
    ]);
    expect(interpolateHourly([])).toEqual([]);
  });
});
