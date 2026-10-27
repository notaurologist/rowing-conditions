import { type GaugeRef, type Metric, type Unit, unitDecimals } from '@rowing/core';

const METRIC_NAMES: Record<Metric, string> = {
  flow: 'flow',
  gaugeHeight: 'gauge height',
  waterTemp: 'water temperature',
  airTemp: 'air temperature',
  windSpeed: 'wind speed',
  windGust: 'wind gusts',
  windDirection: 'wind direction',
  precipChance: 'rain chance',
  combinedTempF: 'combined air and water temperature',
  dewPoint: 'dew point',
};

export function metricName(metric: Metric): string {
  return METRIC_NAMES[metric];
}

const METRIC_ORDER = Object.keys(METRIC_NAMES) as Metric[];

/** "flow, gauge height and water temperature", always in that order. */
export function listMetrics(metrics: readonly Metric[]): string {
  const names = [...metrics]
    .sort((a, b) => METRIC_ORDER.indexOf(a) - METRIC_ORDER.indexOf(b))
    .map(metricName);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export function formatDistanceKm(km: number, units: 'us' | 'metric'): string {
  return units === 'us' ? `${(km / 1.609344).toFixed(1)} mi` : `${km.toFixed(1)} km`;
}

const UNIT_SYMBOLS: Record<Unit, string> = {
  'm3/s': 'm³/s',
  cfs: 'cfs',
  kcfs: 'kcfs',
  m: 'm',
  ft: 'ft',
  degC: '°C',
  degF: '°F',
  'm/s': 'm/s',
  'km/h': 'km/h',
  mph: 'mph',
  percent: '%',
};

export function unitSymbol(unit: Unit): string {
  return UNIT_SYMBOLS[unit];
}

/** A display value at the unit's precision, with thousands separators: "5,060", "143.3". */
export function formatNumber(value: number, unit: Unit): string {
  const decimals = unitDecimals[unit];
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

const COMPASS_POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

/** Meteorological direction (where the wind comes from) as a 16-point compass name. */
export function compassPoint(degrees: number): string {
  const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS_POINTS[index] ?? 'N';
}

/** "just now", "25 min ago", "3 h 5 min ago", "2 days ago"; "in 2 h" for a future time. */
export function formatAge(time: string, now: string): string {
  const minutes = Math.round((Date.parse(now) - Date.parse(time)) / 60_000);
  if (minutes < 0) {
    const ahead = -minutes;
    return ahead < 60 ? `in ${ahead} min` : `in ${Math.round(ahead / 60)} h`;
  }
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h ago` : `${hours} h ${rest} min ago`;
  }
  return `${Math.floor(hours / 24)} days ago`;
}

/** Clock time in the location's time zone, with the date when it isn't today there. */
export function formatTime(time: string, now: string, timeZone: string | null): string {
  const zone = timeZone ?? undefined;
  const day = (t: string) =>
    new Date(t).toLocaleDateString('en-US', { timeZone: zone, month: 'short', day: 'numeric' });
  const clock = new Date(time).toLocaleTimeString('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
  });
  return day(time) === day(now) ? clock : `${day(time)}, ${clock}`;
}

/** "usgs:USGS-01170500" → "USGS 01170500", "nwps:MNTM3" → "NWPS MNTM3". */
export function gaugeId(ref: GaugeRef): string {
  const id = ref.slice(ref.indexOf(':') + 1);
  return ref.startsWith('usgs:') ? `USGS ${id.replace(/^USGS-/, '')}` : `NWPS ${id}`;
}

const SMALL = new Set([
  'at',
  'near',
  'below',
  'above',
  'of',
  'the',
  'and',
  'in',
  'on',
  'nr',
  'abv',
  'blw',
]);

/** "CONNECTICUT RIVER AT MONTAGUE CITY, MA" → "Connecticut River at Montague City, MA". */
export function tidyGaugeName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  const words = name.replace(/\.$/, '').toLowerCase().split(' ');
  return words
    .map((w, i) => {
      if (/^[a-z]{2}$/.test(w) && i === words.length - 1) return w.toUpperCase();
      if (i > 0 && SMALL.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}
