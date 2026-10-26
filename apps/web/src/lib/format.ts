import type { Metric } from '@rowing/core';

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
