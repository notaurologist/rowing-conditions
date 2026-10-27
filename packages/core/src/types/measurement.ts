import { z } from 'zod';

// Internal units are SI except combinedTempF: m³/s, m, °C, m/s, degrees, fraction 0..1, °F.
export const Metric = z.enum([
  'flow',
  'gaugeHeight',
  'waterTemp',
  'airTemp',
  'windSpeed',
  'windGust',
  'windDirection', // meteorological: the direction the wind comes from
  'precipChance',
  'combinedTempF',
  'dewPoint', // context for fog (#42); no limits use it
]);
export type Metric = z.infer<typeof Metric>;

export const Unit = z.enum([
  'm3/s',
  'cfs',
  'kcfs',
  'm',
  'ft',
  'degC',
  'degF',
  'm/s',
  'km/h',
  'mph',
  'percent',
]);
export type Unit = z.infer<typeof Unit>;

// Units a limit on each metric can be entered in. Wind direction has none: directional
// rules come after the MVP.
export const metricUnits: Record<Metric, readonly Unit[]> = {
  flow: ['m3/s', 'cfs', 'kcfs'],
  gaugeHeight: ['m', 'ft'],
  waterTemp: ['degC', 'degF'],
  airTemp: ['degC', 'degF'],
  windSpeed: ['m/s', 'km/h', 'mph'],
  windGust: ['m/s', 'km/h', 'mph'],
  windDirection: [],
  precipChance: ['percent'],
  combinedTempF: ['degF'],
  dewPoint: [], // context only: never a limit
};

// Metrics with a true zero, where a limit of zero or less is meaningless.
export const ratioScaleMetrics: readonly Metric[] = [
  'flow',
  'windSpeed',
  'windGust',
  'precipChance',
];

export function isValueInRange(metric: Metric, value: number): boolean {
  switch (metric) {
    case 'flow':
    case 'windSpeed':
    case 'windGust':
      return value >= 0;
    case 'precipChance':
      return value >= 0 && value <= 1;
    case 'windDirection':
      return value >= 0 && value < 360;
    default:
      return true;
  }
}

// Adapters map each source's qualifier codes to these.
export const Qualifier = z.enum([
  'provisional',
  'estimated',
  'iceAffected',
  'equipmentMalfunction',
  'unreliable', // any other code meaning the value may be wrong, including unrecognized codes
  'reversedFlow', // negative flow: the river running backward, for example toward pumped storage (#116)
]);
export type Qualifier = z.infer<typeof Qualifier>;

export const SourceId = z.enum(['usgs', 'nwps', 'nws']);
export type SourceId = z.infer<typeof SourceId>;

// e.g. 'usgs:USGS-01170500', 'nwps:MNTM3'
export const GaugeRef = z.string().regex(/^(usgs|nwps):\S+$/, 'Expected usgs:<id> or nwps:<id>');
export type GaugeRef = z.infer<typeof GaugeRef>;

// ISO 8601 in UTC, written with Z.
export const UtcTime = z.iso.datetime();

export const Id = z.string().min(1);
