import { z } from 'zod';
import { disqualifyingQualifiers } from '../evaluation/evaluate.ts';
import { UtcTime } from '../types/measurement.ts';
import type { Reading } from '../types/readings.ts';

const HOUR = 3_600_000;

// Whether flow and gauge height are rising, falling or stable, and how fast (#73). Describes
// the readings only: it is never compared against a limit, so these cutoffs are not limits.

export const TrendMetric = z.enum(['flow', 'gaugeHeight']);
export type TrendMetric = z.infer<typeof TrendMetric>;

// The change is measured from the earliest reading in the last 3 hours to the latest. With
// less than 2 hours between them, the trend is unknown.
export const TREND_WINDOW_HOURS = 3;
export const TREND_MIN_SPAN_HOURS = 2;

// Below these rates the trend is stable. Flow is relative, since rivers range from about
// 100 cfs to tens of thousands; gauge height changes are similar in size across rivers.
export const STABLE_FLOW_FRACTION_PER_HOUR = 0.02;
export const STABLE_GAUGE_HEIGHT_PER_HOUR = 0.01; // m

export const Trend = z.discriminatedUnion('direction', [
  z.object({
    metric: TrendMetric,
    direction: z.enum(['rising', 'falling', 'stable']),
    ratePerHour: z.number(), // internal units (m³/s or m) per hour; negative when falling
    from: UtcTime, // the readings the change is measured between
    to: UtcTime,
  }),
  z.object({
    metric: TrendMetric,
    direction: z.literal('unknown'),
    // noReadings: no usable reading. shortHistory: no usable reading 2 to 3 hours before the
    // latest. historyError: the recent readings couldn't be loaded (set by the API).
    reason: z.enum(['noReadings', 'shortHistory', 'historyError']),
  }),
]);
export type Trend = z.infer<typeof Trend>;

// A reading that can be measured from: a value, and no qualifier that makes it unreliable.
function usable(reading: Reading): reading is Reading & { value: number } {
  return (
    reading.value !== null &&
    !(reading.qualifiers ?? []).some((q) => disqualifyingQualifiers.includes(q))
  );
}

// The trend of one metric from its readings, in any order. Readings for other metrics are
// ignored. The window ends at the latest usable reading, not at the current time, so whether
// that reading is stale is left to the reading's own freshness.
export function trendOf(metric: TrendMetric, readings: readonly Reading[]): Trend {
  const points = readings
    .filter((r) => r.metric === metric)
    .filter(usable)
    .map((r) => ({ ms: Date.parse(r.observedAt), value: r.value, at: r.observedAt }))
    .filter((p) => Number.isFinite(p.ms))
    .sort((a, b) => a.ms - b.ms);
  const latest = points.at(-1);
  if (latest === undefined) return { metric, direction: 'unknown', reason: 'noReadings' };

  const earliest = points.find((p) => p.ms >= latest.ms - TREND_WINDOW_HOURS * HOUR);
  const hours = earliest ? (latest.ms - earliest.ms) / HOUR : 0;
  if (earliest === undefined || hours < TREND_MIN_SPAN_HOURS) {
    return { metric, direction: 'unknown', reason: 'shortHistory' };
  }

  const ratePerHour = (latest.value - earliest.value) / hours;
  const stableBelow =
    metric === 'flow'
      ? STABLE_FLOW_FRACTION_PER_HOUR * Math.abs(earliest.value)
      : STABLE_GAUGE_HEIGHT_PER_HOUR;
  const direction =
    ratePerHour === 0 || Math.abs(ratePerHour) < stableBelow
      ? 'stable'
      : ratePerHour > 0
        ? 'rising'
        : 'falling';
  return { metric, direction, ratePerHour, from: earliest.at, to: latest.at };
}
