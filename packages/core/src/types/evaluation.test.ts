import { describe, expect, it } from 'vitest';
import { HourResult } from './evaluation.ts';

const hour = {
  time: '2026-10-25T11:00:00Z',
  status: 'outside',
  light: 'twilight',
  failures: [
    {
      kind: 'limit',
      thresholdId: 't-wind',
      metric: 'windSpeed',
      value: 17,
      limit: 15,
      unit: 'mph',
    },
    { kind: 'daylight' },
  ],
  unknowns: [{ thresholdId: 't-water', metric: 'waterTemp', reason: 'stale' }],
};

describe('HourResult', () => {
  it('accepts limit and daylight failures alongside unknowns', () => {
    expect(HourResult.safeParse(hour).success).toBe(true);
  });

  it('rejects a limit failure missing its values', () => {
    const failures = [{ kind: 'limit', thresholdId: 't-wind', metric: 'windSpeed' }];
    expect(HourResult.safeParse({ ...hour, failures }).success).toBe(false);
  });

  it('rejects an unknown reason outside the defined set', () => {
    const unknowns = [{ thresholdId: 't-water', metric: 'waterTemp', reason: 'late' }];
    expect(HourResult.safeParse({ ...hour, unknowns }).success).toBe(false);
  });
});
