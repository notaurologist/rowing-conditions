import type {
  EvaluationStatus,
  Period,
  PeriodReason,
  Threshold,
  UnknownReason,
} from '@rowing/core';
import { formatNumber, metricName, unitSymbol } from '../../lib/format.ts';

// Plain-language copy for periods and the answer. Neutral wording only: "within" or
// "outside" a named rule set's limits, never a verdict.

/** How club policies word a limit: "at most 15 mph", "below 15 mph", "at least 39 °F". */
export function limitWording(
  comparison: Threshold['comparison'],
  boundary: Threshold['boundary'],
): string {
  if (comparison === 'max') return boundary === 'inclusive' ? 'at most' : 'below';
  return boundary === 'inclusive' ? 'at least' : 'above';
}

const UNKNOWN_WORDS: Record<UnknownReason, (name: string) => string> = {
  missing: (name) => `no ${name} value`,
  stale: (name) => `${name} reading too old`,
  qualified: (name) => `${name} reading flagged as possibly wrong`,
  reversed: (name) => `${name} running backward, so not compared`,
  noSource: (name) => `no source reports ${name} here`,
  noForecast: (name) => `no ${name} forecast, and the last reading is over 3 hours earlier`,
  forecastDisagrees: (name) => `${name} forecast set aside: over 25% off the latest reading`,
};

export function reasonText(reason: PeriodReason): string {
  const name = metricName(reason.metric);
  if (reason.kind === 'unknown') return UNKNOWN_WORDS[reason.reason](name);
  if (reason.kind === 'doubtful') return `${name} from a forecast that doesn't match the gauge`;
  const amount = (v: number) => `${formatNumber(v, reason.unit)} ${unitSymbol(reason.unit)}`;
  const direction = reason.comparison === 'max' ? 'up to' : 'down to';
  return `${name} ${direction} ${amount(reason.worst)} (limit: ${limitWording(reason.comparison, reason.boundary)} ${amount(reason.limit)})`;
}

/** "7 AM", or "6:47 AM" when the minutes aren't zero. */
export function formatClock(time: string, timeZone: string | null): string {
  const text = new Date(time).toLocaleTimeString('en-US', {
    timeZone: timeZone ?? undefined,
    hour: 'numeric',
    minute: '2-digit',
  });
  return text.replace(':00', '');
}

function localDate(time: string, timeZone: string | null): string {
  return new Date(time).toLocaleDateString('en-CA', { timeZone: timeZone ?? undefined });
}

/** "Today", "Tomorrow", or "Wed, Oct 28", by the location's local date. */
export function dayLabel(time: string, now: string, timeZone: string | null): string {
  const day = localDate(time, timeZone);
  if (day === localDate(now, timeZone)) return 'Today';
  if (day === localDate(new Date(Date.parse(now) + 86_400_000).toISOString(), timeZone))
    return 'Tomorrow';
  return new Date(time).toLocaleDateString('en-US', {
    timeZone: timeZone ?? undefined,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
