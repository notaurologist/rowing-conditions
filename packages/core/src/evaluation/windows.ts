import { daylightWindowSpan } from '../daylight/daylight.ts';
import type { HourResult } from '../types/evaluation.ts';
import type { RuleSet } from '../types/rules.ts';

const HOUR = 3_600_000;
const MINUTE = 60_000;

export interface TimeWindow {
  start: string; // ISO 8601, UTC
  end: string; // exclusive
}

export interface WindowContext {
  ruleSet: RuleSet;
  lat: number;
  lon: number;
}

// Edges are cut inward to whole minutes, so a window never starts before the daylight window
// opens or ends after it closes.
function trimToDaylight(
  start: number,
  end: number,
  first: HourResult,
  last: HourResult,
  ctx: WindowContext,
): [number, number] {
  const daylight = ctx.ruleSet.daylight;
  if (daylight === undefined) return [start, end];
  const opening = daylightWindowSpan(first.time, ctx.lat, ctx.lon, daylight);
  const closing = daylightWindowSpan(last.time, ctx.lat, ctx.lon, daylight);
  const trimmedStart =
    opening.kind === 'span'
      ? Math.max(start, Math.ceil(Date.parse(opening.start) / MINUTE) * MINUTE)
      : start;
  const trimmedEnd =
    closing.kind === 'span'
      ? Math.min(end, Math.floor(Date.parse(closing.end) / MINUTE) * MINUTE)
      : end;
  return [trimmedStart, trimmedEnd];
}

// Contiguous runs of within hours. Unknown and outside hours, and gaps in the timeline, end a run.
export function findWindows(hours: readonly HourResult[], ctx: WindowContext): TimeWindow[] {
  const sorted = [...hours].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const runs: HourResult[][] = [];
  let run: HourResult[] = [];

  for (const hour of sorted) {
    const previous = run.at(-1);
    const continues =
      previous !== undefined && Date.parse(hour.time) === Date.parse(previous.time) + HOUR;
    if (hour.status === 'within' && (run.length === 0 || continues)) {
      run.push(hour);
      continue;
    }
    if (run.length > 0) runs.push(run);
    run = hour.status === 'within' ? [hour] : [];
  }
  if (run.length > 0) runs.push(run);

  const windows: TimeWindow[] = [];
  for (const r of runs) {
    const first = r[0] as HourResult;
    const last = r[r.length - 1] as HourResult;
    const [start, end] = trimToDaylight(
      Date.parse(first.time),
      Date.parse(last.time) + HOUR,
      first,
      last,
      ctx,
    );
    if (start < end) {
      windows.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    }
  }
  return windows;
}
