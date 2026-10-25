import { describe, expect, it } from 'vitest';
import { RuleSet, Threshold } from './rules.ts';

const clubA = {
  id: 'rs-club-a',
  name: 'Club A rules',
  boatClasses: [
    { id: 'small', name: '1x and 2x' },
    { id: 'large', name: '4+ and 8+' },
  ],
  thresholds: [
    {
      id: 't-flow',
      metric: 'flow',
      comparison: 'max',
      boundary: 'inclusive',
      value: 566.33693184, // 20 kcfs
      enteredUnit: 'kcfs',
    },
    {
      id: 't-water',
      metric: 'waterTemp',
      comparison: 'min',
      boundary: 'exclusive',
      value: 10,
      enteredUnit: 'degF',
      boatClassIds: ['small'],
    },
  ],
  daylight: { minutesBeforeSunrise: 60, minutesAfterSunset: 30 },
  flowGaugeRef: 'nwps:MNTM3',
};

const threshold = clubA.thresholds[0];

describe('RuleSet', () => {
  it('accepts a rule set with scoped thresholds, a daylight window, and a flow gauge', () => {
    expect(RuleSet.safeParse(clubA).success).toBe(true);
  });

  it('accepts a rule set with no thresholds yet', () => {
    expect(RuleSet.safeParse({ ...clubA, thresholds: [] }).success).toBe(true);
  });

  it('rejects a rule set with no boat classes', () => {
    expect(RuleSet.safeParse({ ...clubA, boatClasses: [], thresholds: [] }).success).toBe(false);
  });

  it('rejects a blank name', () => {
    expect(RuleSet.safeParse({ ...clubA, name: '   ' }).success).toBe(false);
  });

  it('rejects duplicate boat class ids', () => {
    const boatClasses = [
      { id: 'small', name: '1x' },
      { id: 'small', name: '2x' },
    ];
    expect(RuleSet.safeParse({ ...clubA, boatClasses, thresholds: [] }).success).toBe(false);
  });

  it('rejects duplicate threshold ids', () => {
    const thresholds = [threshold, { ...threshold, metric: 'windSpeed', enteredUnit: 'mph' }];
    expect(RuleSet.safeParse({ ...clubA, thresholds }).success).toBe(false);
  });

  it('rejects a threshold scoped to a boat class the rule set does not have', () => {
    const thresholds = [{ ...threshold, boatClassIds: ['eights'] }];
    expect(RuleSet.safeParse({ ...clubA, thresholds }).success).toBe(false);
  });

  it('rejects a flow gauge ref without a known source prefix', () => {
    expect(RuleSet.safeParse({ ...clubA, flowGaugeRef: 'MNTM3' }).success).toBe(false);
    expect(RuleSet.safeParse({ ...clubA, flowGaugeRef: 'usgs:' }).success).toBe(false);
  });
});

describe('Threshold', () => {
  it('rejects a unit that does not belong to the metric', () => {
    expect(Threshold.safeParse({ ...threshold, enteredUnit: 'mph' }).success).toBe(false);
  });

  it('rejects wind direction, which has no limit unit', () => {
    const t = { ...threshold, metric: 'windDirection', value: 180, enteredUnit: 'percent' };
    expect(Threshold.safeParse(t).success).toBe(false);
  });

  it('requires combined temperature to be entered in °F', () => {
    const t = { ...threshold, metric: 'combinedTempF', comparison: 'min', value: 90 };
    expect(Threshold.safeParse({ ...t, enteredUnit: 'degF' }).success).toBe(true);
    expect(Threshold.safeParse({ ...t, enteredUnit: 'degC' }).success).toBe(false);
  });

  it('rejects an empty boat class list; omit it to apply to every class', () => {
    expect(Threshold.safeParse({ ...threshold, boatClassIds: [] }).success).toBe(false);
  });

  it('rejects limits of zero or less for flow, wind, and rain chance', () => {
    for (const [metric, enteredUnit] of [
      ['flow', 'cfs'],
      ['windSpeed', 'mph'],
      ['windGust', 'km/h'],
      ['precipChance', 'percent'],
    ]) {
      const t = { ...threshold, metric, enteredUnit };
      expect(Threshold.safeParse({ ...t, value: 0 }).success).toBe(false);
      expect(Threshold.safeParse({ ...t, value: -1 }).success).toBe(false);
    }
  });

  it('allows zero and negative limits for temperatures', () => {
    const t = { ...threshold, metric: 'airTemp', comparison: 'min', enteredUnit: 'degC' };
    expect(Threshold.safeParse({ ...t, value: 0 }).success).toBe(true);
    expect(Threshold.safeParse({ ...t, value: -5 }).success).toBe(true);
  });

  it('rejects a rain chance limit above 1 (stored as a fraction)', () => {
    const t = { ...threshold, metric: 'precipChance', enteredUnit: 'percent' };
    expect(Threshold.safeParse({ ...t, value: 0.4 }).success).toBe(true);
    expect(Threshold.safeParse({ ...t, value: 40 }).success).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(Threshold.safeParse({ ...threshold, value: Number.NaN }).success).toBe(false);
    expect(Threshold.safeParse({ ...threshold, value: Number.POSITIVE_INFINITY }).success).toBe(
      false,
    );
  });
});

describe('Threshold precision', () => {
  const base = { ...threshold, metric: 'windSpeed', comparison: 'max', enteredUnit: 'mph' };

  it('accepts limits at the precision their unit is shown', () => {
    expect(Threshold.safeParse({ ...base, value: 15 * 0.44704 }).success).toBe(true);
    expect(Threshold.safeParse({ ...threshold, value: 566.33693184 }).success).toBe(true);
  });

  it('rejects a limit more precise than its unit is shown, which rounding would loosen', () => {
    expect(Threshold.safeParse({ ...base, value: 15.5 * 0.44704 }).success).toBe(false);
    const rain = { ...base, metric: 'precipChance', enteredUnit: 'percent' };
    expect(Threshold.safeParse({ ...rain, value: 0.405 }).success).toBe(false);
    const combined = { ...base, metric: 'combinedTempF', comparison: 'min', enteredUnit: 'degF' };
    expect(Threshold.safeParse({ ...combined, value: 89.5 }).success).toBe(false);
    expect(Threshold.safeParse({ ...combined, value: 90 }).success).toBe(true);
  });

  it('allows one decimal in units shown with one', () => {
    const water = { ...base, metric: 'waterTemp', comparison: 'min', enteredUnit: 'degC' };
    expect(Threshold.safeParse({ ...water, value: 4.5 }).success).toBe(true);
    expect(Threshold.safeParse({ ...water, value: 4.55 }).success).toBe(false);
  });
});
