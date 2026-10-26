import type { EvaluationStatus, Period, PeriodReason, UnknownReason } from '@rowing/core';
import { formatNumber, metricName, unitSymbol } from '../../lib/format.ts';
import { limitWording } from './timelineModel.ts';

// Plain-language copy for periods and the answer. Neutral wording only: "within" or
// "outside" a named rule set's limits, never a verdict.

const UNKNOWN_WORDS: Record<UnknownReason, (name: string) => string> = {
  missing: (name) => `no ${name} value`,
  stale: (name) => `${name} reading too old`,
  qualified: (name) => `${name} reading flagged as possibly wrong`,
  noSource: (name) => `no source reports ${name} here`,
};

export function reasonText(reason: PeriodReason): string {
  const name = metricName(reason.metric);
  if (reason.kind === 'unknown') return UNKNOWN_WORDS[reason.reason](name);
  const amount = (v: number) => `${formatNumber(v, reason.unit)} ${unitSymbol(reason.unit)}`;
  const direction = reason.comparison === 'max' ? 'up to' : 'down to';
  return `${name} ${direction} ${amount(reason.worst)} (limit: ${limitWording(reason.comparison, reason.boundary)} ${amount(reason.limit)})`;
}

/** Mid-sentence form: "within Club A's limits", "outside Club A's limits", "unknown". */
export function statusPhrase(status: EvaluationStatus, ruleSetName: string): string {
  return status === 'unknown' ? 'unknown' : `${status} ${ruleSetName}'s limits`;
}

/** Sentence-start form: "Within Club A's limits". */
export function statusText(status: EvaluationStatus, ruleSetName: string): string {
  const phrase = statusPhrase(status, ruleSetName);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
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

/** "Today 11 AM – 3 PM". Periods never cross midnight: night hours aren't rowing hours. */
export function formatRange(
  start: string,
  end: string,
  now: string,
  timeZone: string | null,
): string {
  return `${dayLabel(start, now, timeZone)} ${formatClock(start, timeZone)} – ${formatClock(end, timeZone)}`;
}

/** Reasons from several periods: the worst value per limit, each unknown once, hours summed. */
export function mergeReasons(periods: readonly Period[]): PeriodReason[] {
  const merged = new Map<string, PeriodReason>();
  for (const reason of periods.flatMap((p) => p.reasons)) {
    const key = reason.kind === 'limit' ? reason.thresholdId : `${reason.metric}:${reason.reason}`;
    const seen = merged.get(key);
    if (!seen) {
      merged.set(key, { ...reason });
    } else if (seen.kind === 'limit' && reason.kind === 'limit') {
      const worse = seen.comparison === 'max' ? Math.max : Math.min;
      merged.set(key, {
        ...seen,
        worst: worse(seen.worst, reason.worst),
        hours: seen.hours + reason.hours,
      });
    } else {
      merged.set(key, { ...seen, hours: seen.hours + reason.hours });
    }
  }
  return [...merged.values()];
}
