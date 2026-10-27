import { describe, expect, it } from 'vitest';
import type { Unit } from '../types/measurement.ts';
import {
  combinedTempF,
  displayUnits,
  displayValue,
  fromInternal,
  fromSI,
  roundHalfAwayFromZero,
  temperatureDifference,
  toDisplay,
  toInternal,
  toSI,
  unitDecimals,
} from './units.ts';

// [SI value, unit, value in that unit]
const knownValues: [number, Unit, number][] = [
  [1, 'm3/s', 1],
  [0.028316846592, 'cfs', 1],
  [28.316846592, 'cfs', 1000],
  [28.316846592, 'kcfs', 1],
  [566.33693184, 'kcfs', 20],
  [1, 'm', 1],
  [0.3048, 'ft', 1],
  [3.048, 'ft', 10],
  [10, 'degC', 10],
  [0, 'degF', 32],
  [100, 'degF', 212],
  [-40, 'degF', -40],
  [3.9, 'degF', 39.02],
  [1, 'm/s', 1],
  [1, 'km/h', 3.6],
  [10, 'km/h', 36],
  [0.44704, 'mph', 1],
  [6.7056, 'mph', 15],
  [0.25, 'percent', 25],
  [1, 'percent', 100],
];

describe('fromSI and toSI', () => {
  it.each(knownValues)('%d SI is %s %d', (si, unit, value) => {
    expect(fromSI(si, unit)).toBeCloseTo(value, 9);
    expect(toSI(value, unit)).toBeCloseTo(si, 9);
  });

  it('round-trips every unit', () => {
    for (const unit of Object.keys(unitDecimals) as Unit[]) {
      for (const si of [-12.5, 0, 0.3, 7, 425.5]) {
        expect(toSI(fromSI(si, unit), unit), `${unit} ${si}`).toBeCloseTo(si, 9);
      }
    }
  });
});

describe('unitDecimals', () => {
  it('matches the precision table in ARCHITECTURE.md', () => {
    expect(unitDecimals).toEqual({
      cfs: 0,
      kcfs: 1,
      'm3/s': 1,
      ft: 2,
      m: 2,
      degF: 0,
      degC: 1,
      mph: 0,
      'km/h': 0,
      'm/s': 1,
      percent: 0,
    });
  });
});

describe('roundHalfAwayFromZero', () => {
  it.each([
    [2.5, 0, 3],
    [-2.5, 0, -3],
    [0.5, 0, 1],
    [1.45, 1, 1.5],
    [-1.45, 1, -1.5],
    [2.675, 2, 2.68], // 2.675 is 2.67499999... in binary
    [1.005, 2, 1.01], // 1.005 is 1.00499999... in binary
    [14.499, 0, 14],
    [15.000000000000002, 0, 15],
  ])('rounds %d to %d decimals as %d', (value, decimals, expected) => {
    expect(roundHalfAwayFromZero(value, decimals)).toBe(expected);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundHalfAwayFromZero(-0.4, 0), 0)).toBe(true);
  });
});

describe('toDisplay', () => {
  it('converts from SI and rounds to the unit precision', () => {
    expect(toDisplay(6.7056, 'mph')).toBe(15);
    expect(toDisplay(425.5, 'cfs')).toBe(15026);
    expect(toDisplay(425.5, 'kcfs')).toBe(15);
    expect(toDisplay(3.9, 'degF')).toBe(39);
    expect(toDisplay(3.95, 'degC')).toBe(4);
    expect(toDisplay(0.355, 'percent')).toBe(36);
  });

  it('shows a 24 km/h forecast as 15 mph, the case DOMAIN.md describes', () => {
    expect(toDisplay(toSI(24, 'km/h'), 'mph')).toBe(15);
  });
});

describe('fromInternal, toInternal, and displayValue', () => {
  it('convert SI metrics like fromSI and toSI', () => {
    expect(fromInternal('airTemp', 0, 'degF')).toBe(32);
    expect(toInternal('airTemp', 32, 'degF')).toBe(0);
    expect(displayValue('windSpeed', 6.7056, 'mph')).toBe(15);
  });

  it('leave combined temperature in °F, its internal unit', () => {
    expect(fromInternal('combinedTempF', 90, 'degF')).toBe(90);
    expect(toInternal('combinedTempF', 90, 'degF')).toBe(90);
    expect(displayValue('combinedTempF', 89.6, 'degF')).toBe(90);
  });

  it('refuse combined temperature in any unit but °F', () => {
    expect(() => fromInternal('combinedTempF', 90, 'degC')).toThrow();
    expect(() => toInternal('combinedTempF', 32, 'degC')).toThrow();
  });
});

describe('combinedTempF', () => {
  it('adds air and water temperature after rounding each to a whole °F', () => {
    // 7.0 °C is 44.6 °F, shown as 45. The rounded parts sum to 90; the exact sum is 89.2.
    expect(combinedTempF(7, 7)).toBe(90);
  });

  it('handles below-freezing air', () => {
    // -5 °C is 23 °F; 4 °C is 39.2 °F, shown as 39.
    expect(combinedTempF(-5, 4)).toBe(62);
  });
});

describe('displayUnits', () => {
  it('uses US units, keeping rain chance as percent', () => {
    expect(displayUnits.us).toEqual({
      flow: 'cfs',
      gaugeHeight: 'ft',
      waterTemp: 'degF',
      airTemp: 'degF',
      windSpeed: 'mph',
      windGust: 'mph',
      precipChance: 'percent',
      combinedTempF: 'degF',
      dewPoint: 'degF',
    });
  });

  it('uses metric units, but keeps combined temperature in °F', () => {
    expect(displayUnits.metric).toEqual({
      flow: 'm3/s',
      gaugeHeight: 'm',
      waterTemp: 'degC',
      airTemp: 'degC',
      windSpeed: 'km/h',
      windGust: 'km/h',
      precipChance: 'percent',
      combinedTempF: 'degF',
      dewPoint: 'degC',
    });
  });
});

describe('temperatureDifference', () => {
  it('scales a difference without the 32° offset (#42)', () => {
    expect(temperatureDifference(5, 'degF')).toBe(9);
    expect(temperatureDifference(5, 'degC')).toBe(5);
    expect(temperatureDifference(0, 'degF')).toBe(0);
    expect(temperatureDifference(-1.5, 'degF')).toBe(-3);
  });

  it('rounds at display precision', () => {
    expect(temperatureDifference(1.25, 'degC')).toBe(1.3);
    expect(temperatureDifference(1.1, 'degF')).toBe(2);
  });
});
