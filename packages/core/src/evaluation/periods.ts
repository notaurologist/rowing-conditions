import { civilDaylightSpan } from '../daylight/daylight.ts';
import type { EvaluationStatus, HourResult, UnknownReason } from '../types/evaluation.ts';
import type { Metric, Unit } from '../types/measurement.ts';
import type { Threshold } from '../types/rules.ts';
import { isRowingHour, trimToDaylight, type WindowContext } from './windows.ts';

const HOUR = 3_600_000;
const MINUTE = 60_000;

export type PeriodReason =
  | {
      kind: 'limit';
      thresholdId: string;
      metric: Metric;
      comparison: Threshold['comparison'];
      boundary: Threshold['boundary'];
      worst: number; // the furthest past the limit in the period, rounded, in unit
      limit: number;
      unit: Unit;
      hours: number; // hours in the period that failed this limit
    }
  | { kind: 'unknown'; metric: Metric; reason: UnknownReason; hours: number }
  // A value the app doubts, why, and in how many hours (decision 0020).
  | { kind: 'doubtful'; metric: Metric; reason: 'forecastDisagrees'; hours: number };

export interface Period {
  status: EvaluationStatus;
  start: string; // ISO 8601, UTC
  end: string; // exclusive
  reasons: PeriodReason[]; // empty for within; for probably within, what's doubted
}

function reasonsFor(run: HourResult[], ctx: WindowContext): PeriodReason[] {
  const limits = new Map<string, Extract<PeriodReason, { kind: 'limit' }>>();
  const unknowns = new Map<string, Extract<PeriodReason, { kind: 'unknown' }>>();
  const doubts = new Map<string, Extract<PeriodReason, { kind: 'doubtful' }>>();
  for (const hour of run) {
    for (const failure of hour.failures) {
      if (failure.kind !== 'limit') continue;
      const threshold = ctx.ruleSet.thresholds.find((t) => t.id === failure.thresholdId);
      if (!threshold) continue;
      const seen = limits.get(failure.thresholdId);
      const worse = (a: number, b: number) =>
        threshold.comparison === 'max' ? Math.max(a, b) : Math.min(a, b);
      limits.set(failure.thresholdId, {
        kind: 'limit',
        thresholdId: failure.thresholdId,
        metric: failure.metric,
        comparison: threshold.comparison,
        boundary: threshold.boundary,
        worst: seen ? worse(seen.worst, failure.value) : failure.value,
        limit: failure.limit,
        unit: failure.unit,
        hours: (seen?.hours ?? 0) + 1,
      });
    }
    // One entry per metric and reason, counted once per hour.
    const inHour = new Set(hour.unknowns.map((u) => `${u.metric}:${u.reason}`));
    for (const key of inHour) {
      const [metric, reason] = key.split(':') as [Metric, UnknownReason];
      const seen = unknowns.get(key);
      unknowns.set(key, { kind: 'unknown', metric, reason, hours: (seen?.hours ?? 0) + 1 });
    }
    const doubtedInHour = new Set((hour.doubtful ?? []).map((d) => d.metric));
    for (const metric of doubtedInHour) {
      const seen = doubts.get(metric);
      doubts.set(metric, {
        kind: 'doubtful',
        metric,
        reason: 'forecastDisagrees',
        hours: (seen?.hours ?? 0) + 1,
      });
    }
  }
  return [...limits.values(), ...unknowns.values(), ...doubts.values()];
}

// Periods are cut to whole minutes at the edges of the rowing span: the rule set's daylight
// window if it has one, otherwise civil dawn to civil dusk. So a period never runs into the dark.
function trimToSpan(
  start: number,
  end: number,
  first: HourResult,
  last: HourResult,
  ctx: WindowContext,
): [number, number] {
  if (ctx.ruleSet.daylight !== undefined) return trimToDaylight(start, end, first, last, ctx);
  const opening = civilDaylightSpan(first.time, ctx.lat, ctx.lon);
  const closing = civilDaylightSpan(last.time, ctx.lat, ctx.lon);
  return [
    opening.kind === 'span'
      ? Math.max(start, Math.ceil(Date.parse(opening.start) / MINUTE) * MINUTE)
      : start,
    closing.kind === 'span'
      ? Math.min(end, Math.floor(Date.parse(closing.end) / MINUTE) * MINUTE)
      : end,
  ];
}

/**
 * Rowing hours grouped into runs of the same status, each with its reasons: the worst value
 * against every limit that failed, and every metric that was unknown and why. Hours outside
 * civil dawn to dusk (or the rule set's daylight window) are left out, so periods are split
 * by night and by gaps.
 */
export function findPeriods(hours: readonly HourResult[], ctx: WindowContext): Period[] {
  const sorted = [...hours]
    .filter((h) => isRowingHour(h, ctx))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));

  const runs: HourResult[][] = [];
  for (const hour of sorted) {
    const run = runs.at(-1);
    const previous = run?.at(-1);
    if (
      run &&
      previous &&
      previous.status === hour.status &&
      Date.parse(hour.time) === Date.parse(previous.time) + HOUR
    ) {
      run.push(hour);
    } else {
      runs.push([hour]);
    }
  }

  const periods: Period[] = [];
  for (const run of runs) {
    const first = run[0] as HourResult;
    const last = run[run.length - 1] as HourResult;
    const [start, end] = trimToSpan(
      Date.parse(first.time),
      Date.parse(last.time) + HOUR,
      first,
      last,
      ctx,
    );
    if (start >= end) continue;
    periods.push({
      status: first.status,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      reasons: reasonsFor(run, ctx), // empty for within: those hours have no failures or unknowns
    });
  }
  return periods;
}

export interface NextWindow {
  window: Period;
  before?: Period; // the period under way now, when the window starts later
  following?: Period; // the next period after the window that isn't within
}

/** The first within period that isn't over at `now`, with what comes before and after it. */
// The next window of the given status: within by default, or probably within (decision 0020).
export function nextWindow(
  periods: readonly Period[],
  now: string,
  status: 'within' | 'probablyWithin' = 'within',
): NextWindow | null {
  const nowMs = Date.parse(now);
  const index = periods.findIndex((p) => p.status === status && Date.parse(p.end) > nowMs);
  const window = periods[index];
  if (!window) return null;
  // What follows is the next change: a later period of the same status isn't one.
  const following = periods.slice(index + 1).find((p) => p.status !== status);
  const before =
    Date.parse(window.start) > nowMs
      ? periods.find((p) => Date.parse(p.start) <= nowMs && Date.parse(p.end) > nowMs)
      : undefined;
  return { window, ...(before ? { before } : {}), ...(following ? { following } : {}) };
}
