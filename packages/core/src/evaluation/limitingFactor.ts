import type { HourResult } from '../types/evaluation.ts';
import type { Metric } from '../types/measurement.ts';
import type { ForecastPoint } from '../types/readings.ts';
import type { Threshold } from '../types/rules.ts';
import { combinedTempF } from '../units/units.ts';
import { forecastForRuleSet, type TimelineInput, type TimelineResult } from './evaluate.ts';
import { isRowingHour } from './windows.ts';

export interface LimitingFactor {
  metric: Metric;
  reason: 'mostHoursOutside' | 'leastHeadroom';
  hoursOutside: number;
  headroom: number; // unitless; negative when the worst value is past the limit
}

// Fixed scales for metrics without a true zero, where a ratio to the limit is meaningless.
// Starting values; tune in M9.
const fixedScales: Partial<Record<Metric, number>> = {
  waterTemp: 10, // °C
  airTemp: 10, // °C
  combinedTempF: 18, // °F
  gaugeHeight: 1, // m
};

function headroomOf(threshold: Threshold, worst: number): number {
  const margin = threshold.comparison === 'max' ? threshold.value - worst : worst - threshold.value;
  const scale = fixedScales[threshold.metric] ?? threshold.value;
  return margin / scale;
}

// The value a threshold was compared against, in the metric's internal unit.
function valueFor(threshold: Threshold, point: ForecastPoint): number | undefined {
  if (threshold.metric === 'combinedTempF') {
    const { airTemp, waterTemp } = point.values;
    return typeof airTemp === 'number' && typeof waterTemp === 'number'
      ? combinedTempF(airTemp, waterTemp)
      : undefined;
  }
  const value = point.values[threshold.metric];
  return typeof value === 'number' ? value : undefined;
}

// The metric deciding things for this rule set and boat class, for the chart's default.
// Pass the same input given to evaluateTimeline, and its result.
export function findLimitingFactor(
  input: TimelineInput,
  timeline: TimelineResult,
): LimitingFactor | null {
  const points = new Map(forecastForRuleSet(input).map((p) => [Date.parse(p.time), p]));
  const rowingHours = timeline.hours.filter((h) => isRowingHour(h, input));
  // Metrics in timeline.unavailableMetrics have no values and so no headroom; they drop out below.
  const thresholds = input.ruleSet.thresholds.filter(
    (t) => t.boatClassIds === undefined || t.boatClassIds.includes(input.boatClassId),
  );

  const byMetric = new Map<Metric, { outsideHours: Set<string>; headroom: number | null }>();
  for (const threshold of thresholds) {
    const entry = byMetric.get(threshold.metric) ?? { outsideHours: new Set(), headroom: null };
    let worst: number | undefined;
    for (const hour of rowingHours) {
      if (hour.failures.some((f) => f.kind === 'limit' && f.thresholdId === threshold.id)) {
        entry.outsideHours.add(hour.time);
      }
      if (hour.unknowns.some((u) => u.thresholdId === threshold.id)) continue;
      const point = points.get(Date.parse(hour.time));
      const value = point === undefined ? undefined : valueFor(threshold, point);
      if (value === undefined) continue;
      const isWorse =
        threshold.comparison === 'max' ? value > (worst ?? -Infinity) : value < (worst ?? Infinity);
      if (isWorse) worst = value;
    }
    if (worst !== undefined) {
      const headroom = headroomOf(threshold, worst);
      entry.headroom = entry.headroom === null ? headroom : Math.min(entry.headroom, headroom);
    }
    byMetric.set(threshold.metric, entry);
  }

  const candidates = [...byMetric.entries()]
    .filter(([, e]) => e.headroom !== null)
    .map(([metric, e]) => ({
      metric,
      hoursOutside: e.outsideHours.size,
      headroom: e.headroom as number,
    }))
    .sort((a, b) => b.hoursOutside - a.hoursOutside || a.headroom - b.headroom);

  const best = candidates[0];
  if (best === undefined) return null;
  return { ...best, reason: best.hoursOutside > 0 ? 'mostHoursOutside' : 'leastHeadroom' };
}
