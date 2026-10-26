import type { Metric } from '../types/measurement.ts';
import type { ForecastPoint } from '../types/readings.ts';
import type { LimitingFactor } from './limitingFactor.ts';

// What the timeline chart can show. Wind speed and gusts share one chart. Wind direction
// has no chart until directional rules arrive.
export const CHART_METRICS = [
  'flow',
  'gaugeHeight',
  'wind',
  'waterTemp',
  'airTemp',
  'combinedTempF',
  'precipChance',
] as const;
export type ChartMetric = (typeof CHART_METRICS)[number];

export function chartMetricOf(metric: Metric): ChartMetric | null {
  if (metric === 'windSpeed' || metric === 'windGust') return 'wind';
  if (metric === 'windDirection') return null;
  return metric;
}

const hasValue = (points: readonly ForecastPoint[], metric: Metric) =>
  points.some((p) => typeof p.values[metric] === 'number');

/** Chart metrics with a value in at least one hour, in CHART_METRICS order. */
export function availableChartMetrics(forecast: readonly ForecastPoint[]): ChartMetric[] {
  return CHART_METRICS.filter((metric) => {
    if (metric === 'wind') return hasValue(forecast, 'windSpeed') || hasValue(forecast, 'windGust');
    if (metric === 'combinedTempF') {
      return forecast.some(
        (p) => typeof p.values.airTemp === 'number' && typeof p.values.waterTemp === 'number',
      );
    }
    return hasValue(forecast, metric);
  });
}

export type ChartChoice =
  | { metric: ChartMetric; reason: 'pinned' | 'fallback' }
  | { metric: ChartMetric; reason: LimitingFactor['reason']; hoursOutside: number };

// Fallbacks when no rule set decides: flow is the main river hazard, wind the main one on a lake.
const FALLBACK_ORDER: ChartMetric[] = ['flow', 'wind'];

/**
 * The chart's default metric: the user's pinned metric, else the limiting factor for the
 * selected rule set and boat class, else flow, else wind, else the first with data.
 * Only metrics with data at this location are chosen. Null when nothing has data.
 */
export function defaultChartMetric(input: {
  available: readonly ChartMetric[];
  pinned?: ChartMetric | undefined;
  limiting: LimitingFactor | null;
}): ChartChoice | null {
  const { available, pinned, limiting } = input;
  if (pinned && available.includes(pinned)) return { metric: pinned, reason: 'pinned' };
  const limitingMetric = limiting ? chartMetricOf(limiting.metric) : null;
  if (limiting && limitingMetric && available.includes(limitingMetric)) {
    return { metric: limitingMetric, reason: limiting.reason, hoursOutside: limiting.hoursOutside };
  }
  const fallback = FALLBACK_ORDER.find((m) => available.includes(m)) ?? available[0];
  return fallback ? { metric: fallback, reason: 'fallback' } : null;
}
