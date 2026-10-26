import { describe, expect, it } from 'vitest';
import { Threshold } from '../types/rules.ts';
import { toInternal } from '../units/units.ts';
import { entryFromThreshold, LIMIT_METRICS, thresholdFromEntry, WORDING } from './entry.ts';

describe('WORDING', () => {
  it('maps each phrase club policies use to a comparison and boundary', () => {
    expect(WORDING).toEqual({
      atMost: { comparison: 'max', boundary: 'inclusive' },
      below: { comparison: 'max', boundary: 'exclusive' },
      atLeast: { comparison: 'min', boundary: 'inclusive' },
      above: { comparison: 'min', boundary: 'exclusive' },
    });
  });
});

describe('thresholdFromEntry', () => {
  it('stores the value in the internal unit and keeps the unit it was entered in', () => {
    const t = thresholdFromEntry({
      id: 't',
      metric: 'windGust',
      wording: 'below',
      value: 15,
      unit: 'mph',
    });
    expect(t).toEqual({
      id: 't',
      metric: 'windGust',
      comparison: 'max',
      boundary: 'exclusive',
      value: toInternal('windGust', 15, 'mph'),
      enteredUnit: 'mph',
    });
    expect(Threshold.safeParse(t).success).toBe(true);
  });

  it('keeps combined temperature in °F and rain chance as a fraction', () => {
    expect(
      thresholdFromEntry({
        id: 'c',
        metric: 'combinedTempF',
        wording: 'atLeast',
        value: 90,
        unit: 'degF',
      }).value,
    ).toBe(90);
    expect(
      thresholdFromEntry({
        id: 'r',
        metric: 'precipChance',
        wording: 'atMost',
        value: 40,
        unit: 'percent',
      }).value,
    ).toBeCloseTo(0.4);
  });

  it('scopes a limit to boat classes only when some are named', () => {
    expect(
      thresholdFromEntry({
        id: 't',
        metric: 'flow',
        wording: 'atMost',
        value: 20,
        unit: 'kcfs',
        boatClassIds: ['small'],
      }).boatClassIds,
    ).toEqual(['small']);
    expect(
      thresholdFromEntry({
        id: 't',
        metric: 'flow',
        wording: 'atMost',
        value: 20,
        unit: 'kcfs',
        boatClassIds: [],
      }),
    ).not.toHaveProperty('boatClassIds');
  });
});

describe('entryFromThreshold', () => {
  it('gives back the number and unit the user typed', () => {
    for (const [metric, value, unit] of [
      ['flow', 20, 'kcfs'],
      ['flow', 3100, 'cfs'],
      ['waterTemp', 39, 'degF'],
      ['waterTemp', 3.9, 'degC'],
      ['windGust', 15, 'mph'],
      ['precipChance', 40, 'percent'],
      ['combinedTempF', 90, 'degF'],
    ] as const) {
      const entry = { id: 't', metric, wording: 'atMost' as const, value, unit };
      expect(entryFromThreshold(thresholdFromEntry(entry))).toEqual(entry);
    }
  });

  it('gives back the wording and boat classes', () => {
    const entry = {
      id: 't',
      metric: 'airTemp' as const,
      wording: 'above' as const,
      value: 36,
      unit: 'degF' as const,
      boatClassIds: ['big'],
    };
    expect(entryFromThreshold(thresholdFromEntry(entry))).toEqual(entry);
  });
});

describe('LIMIT_METRICS', () => {
  it('offers every metric that can carry a limit, and not wind direction', () => {
    expect(LIMIT_METRICS).toEqual([
      'flow',
      'gaugeHeight',
      'waterTemp',
      'airTemp',
      'combinedTempF',
      'windSpeed',
      'windGust',
      'precipChance',
    ]);
  });
});
