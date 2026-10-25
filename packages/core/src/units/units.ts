import type { Metric, Unit } from '../types/measurement.ts';

// Exact definitions: 1 ft = 0.3048 m, 1 mi = 1609.344 m.
const CUBIC_METERS_PER_CUBIC_FOOT = 0.3048 ** 3;
const METERS_PER_SECOND_PER_MPH = 0.44704;

// Converts an SI value to `unit`. For a metric's internal value use fromInternal, since
// combinedTempF is stored in °F.
export function fromSI(value: number, unit: Unit): number {
  switch (unit) {
    case 'm3/s':
    case 'm':
    case 'degC':
    case 'm/s':
      return value;
    case 'cfs':
      return value / CUBIC_METERS_PER_CUBIC_FOOT;
    case 'kcfs':
      return value / CUBIC_METERS_PER_CUBIC_FOOT / 1000;
    case 'ft':
      return value / 0.3048;
    case 'degF':
      return (value * 9) / 5 + 32;
    case 'km/h':
      return value * 3.6;
    case 'mph':
      return value / METERS_PER_SECOND_PER_MPH;
    case 'percent':
      return value * 100;
  }
}

export function toSI(value: number, unit: Unit): number {
  switch (unit) {
    case 'm3/s':
    case 'm':
    case 'degC':
    case 'm/s':
      return value;
    case 'cfs':
      return value * CUBIC_METERS_PER_CUBIC_FOOT;
    case 'kcfs':
      return value * 1000 * CUBIC_METERS_PER_CUBIC_FOOT;
    case 'ft':
      return value * 0.3048;
    case 'degF':
      return ((value - 32) * 5) / 9;
    case 'km/h':
      return value / 3.6;
    case 'mph':
      return value * METERS_PER_SECOND_PER_MPH;
    case 'percent':
      return value / 100;
  }
}

// Display precision, shared by evaluation and the UI so comparisons match what users see.
export const unitDecimals: Record<Unit, number> = {
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
};

// Values are first trimmed to 12 significant digits, so binary noise (2.675 stored as
// 2.67499999...) does not move a value across a rounding boundary.
export function roundHalfAwayFromZero(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = Number((Math.abs(Number(value.toPrecision(12))) * factor).toPrecision(12));
  const rounded = (Math.sign(value) * Math.round(scaled)) / factor;
  return rounded === 0 ? 0 : rounded;
}

export function toDisplay(value: number, unit: Unit): number {
  return roundHalfAwayFromZero(fromSI(value, unit), unitDecimals[unit]);
}

// Internal values are SI, except combinedTempF, which is already in °F.
function assertCombinedInF(metric: Metric, unit: Unit): void {
  if (metric === 'combinedTempF' && unit !== 'degF') {
    throw new Error(`combinedTempF is only expressed in degF, not ${unit}`);
  }
}

export function fromInternal(metric: Metric, value: number, unit: Unit): number {
  assertCombinedInF(metric, unit);
  return metric === 'combinedTempF' ? value : fromSI(value, unit);
}

export function toInternal(metric: Metric, value: number, unit: Unit): number {
  assertCombinedInF(metric, unit);
  return metric === 'combinedTempF' ? value : toSI(value, unit);
}

// A metric's internal value as shown on screen, and as compared against limits.
export function displayValue(metric: Metric, value: number, unit: Unit): number {
  return roundHalfAwayFromZero(fromInternal(metric, value, unit), unitDecimals[unit]);
}

// Clubs define this rule in °F and add the two readings as shown, so each part is rounded first.
export function combinedTempF(airTempC: number, waterTempC: number): number {
  return toDisplay(airTempC, 'degF') + toDisplay(waterTempC, 'degF');
}

export type DisplaySystem = 'us' | 'metric';

// Wind direction is shown in degrees in both systems, so it has no entry.
export const displayUnits: Record<DisplaySystem, Record<Exclude<Metric, 'windDirection'>, Unit>> = {
  us: {
    flow: 'cfs',
    gaugeHeight: 'ft',
    waterTemp: 'degF',
    airTemp: 'degF',
    windSpeed: 'mph',
    windGust: 'mph',
    precipChance: 'percent',
    combinedTempF: 'degF',
  },
  metric: {
    flow: 'm3/s',
    gaugeHeight: 'm',
    waterTemp: 'degC',
    airTemp: 'degC',
    windSpeed: 'km/h',
    windGust: 'km/h',
    precipChance: 'percent',
    combinedTempF: 'degF',
  },
};
