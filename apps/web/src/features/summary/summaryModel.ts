import { displayValue, type Metric, nextWindow, type Period } from '@rowing/core';
import type { Conditions } from '../../lib/api.ts';
import { formatNumber, metricName, unitSymbol } from '../../lib/format.ts';
import type { LocationEvaluation } from '../timeline/evaluateLocation.ts';
import { dayLabel, formatClock, reasonText } from '../timeline/periodCopy.ts';

// The words at the top of the main screen: the answer, why, how sure, and each day from dawn to
// dusk. Neutral wording only: "within" or "outside" a named rule set's limits, never a verdict.

export interface Summary {
  headline: string;
  detail: string[];
  days: { name: string; text: string }[];
}

export interface SummaryInput {
  conditions: Conditions;
  evaluated: LocationEvaluation | null;
  now: string;
}

const HOUR = 3_600_000;
const MINUTE = 60_000;
// A measurement this far from the forecast for its hour is worth saying out loud.
const DISAGREEMENT = 0.1;
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

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Wind gusts are plural; every other metric name is singular.
const plural = (metric: Metric) => metric === 'windGust';

function deciding(
  evaluated: LocationEvaluation,
  conditions: Conditions,
  window: Period | undefined,
): string[] {
  const limiting = evaluated.limiting;
  if (!limiting) return [];
  const name = capitalize(metricName(limiting.metric));
  const many = plural(limiting.metric);
  const first =
    limiting.reason === 'mostHoursOutside'
      ? `${name} ${many ? 'decide' : 'decides'} it, with ${limiting.hoursOutside} rowing ${limiting.hoursOutside === 1 ? 'hour' : 'hours'} past ${many ? 'their' : 'its'} limit.`
      : `${name} ${many ? 'decide' : 'decides'} it, coming closest to ${many ? 'their' : 'its'} limit.`;
  const sentences = [first];

  // The closest the deciding metric comes to its limit during the window, in the limit's unit.
  const threshold = evaluated.ruleSet.thresholds.find(
    (t) =>
      t.metric === limiting.metric &&
      (t.boatClassIds === undefined || t.boatClassIds.includes(evaluated.evaluation.boatClassId)),
  );
  if (window && threshold && threshold.metric !== 'combinedTempF') {
    const unit = threshold.enteredUnit;
    const limit = displayValue(threshold.metric, threshold.value, unit);
    const start = Date.parse(window.start) - HOUR;
    const end = Date.parse(window.end);
    const margins = conditions.forecast
      .filter(
        (p) =>
          Date.parse(p.time) >= start &&
          Date.parse(p.time) < end &&
          Date.parse(p.time) + HOUR > Date.parse(window.start),
      )
      .map((p) => p.values[threshold.metric])
      .filter((v): v is number => typeof v === 'number')
      .map((v) => Math.abs(displayValue(threshold.metric, v, unit) - limit));
    if (margins.length > 0) {
      const amount = (v: number) => `${formatNumber(v, unit)} ${unitSymbol(unit)}`;
      sentences.push(
        `In the window, ${many ? 'they come' : 'it comes'} no closer than ${amount(Math.min(...margins))} to the ${amount(limit)} limit.`,
      );
    }
  }
  return sentences;
}

function measurementNote(conditions: Conditions): string[] {
  const reading = conditions.current.find((r) => r.metric === 'flow');
  if (!reading || reading.value === null) return [];
  const hour = new Date(Math.floor(Date.parse(reading.observedAt) / HOUR) * HOUR).toISOString();
  const forecast = conditions.forecast.find((p) => p.time === hour)?.values.flow;
  if (typeof forecast !== 'number' || forecast <= 0) return [];
  if (Math.abs(reading.value - forecast) / forecast <= DISAGREEMENT) return [];
  const cfs = (v: number) => `${formatNumber(displayValue('flow', v, 'cfs'), 'cfs')} cfs`;
  const clock = formatClock(reading.observedAt, conditions.location.timezone);
  return [
    `The river measured ${cfs(reading.value)} at ${clock}; the forecast for that hour was ${cfs(forecast)}.`,
  ];
}

function dayPhrase(time: string, now: string, timeZone: string | null): string {
  const label = dayLabel(time, now, timeZone);
  if (label === 'Today' || label === 'Tomorrow') return label.toLowerCase();
  return `on ${new Date(time).toLocaleDateString('en-US', { timeZone: timeZone ?? undefined, weekday: 'long' })}`;
}

function headline(evaluated: LocationEvaluation, now: string, timeZone: string | null): string {
  const name = evaluated.ruleSet.name;
  const next = nextWindow(evaluated.periods, now);
  if (!next) return `No hours within ${name}’s limits from dawn to dusk in the next 48 hours`;
  const { window } = next;
  const clock = (t: string) => formatClock(t, timeZone);
  if (Date.parse(window.start) <= Date.parse(now)) {
    const sameDay = dayLabel(window.end, now, timeZone) === dayLabel(now, now, timeZone);
    return `Within ${name}’s limits now, until ${sameDay ? '' : `${dayPhrase(window.end, now, timeZone)} `}${clock(window.end)}`;
  }
  return `Within ${name}’s limits ${dayPhrase(window.start, now, timeZone)}, ${clock(window.start)} to ${clock(window.end)}`;
}

// Periods are cut to the minute at civil dawn and dusk, so an edge within a minute of one is it.
function edgeWord(time: string, conditions: Conditions): 'dawn' | 'dusk' | null {
  const t = Date.parse(time);
  for (const day of conditions.daylight) {
    if (day.civilDawn && Math.abs(Date.parse(day.civilDawn) - t) < MINUTE) return 'dawn';
    if (day.civilDusk && Math.abs(Date.parse(day.civilDusk) - t) < MINUTE) return 'dusk';
  }
  return null;
}

function periodSentence(p: Period, conditions: Conditions): string {
  const tz = conditions.location.timezone;
  const point = (time: string) => {
    const edge = edgeWord(time, conditions);
    return edge ? `${edge}, ${formatClock(time, tz)}` : formatClock(time, tz);
  };
  const from = point(p.start);
  const to = point(p.end);
  const span = `from ${from}${from.includes(',') ? ',' : ''} to ${to}`;
  const status = p.status === 'within' ? 'Within' : p.status === 'outside' ? 'Outside' : 'Unknown';
  const reasons = p.reasons.map(reasonText).join('; ');
  return `${status} ${span}${reasons ? `: ${reasons}` : ''}.`;
}

function days(evaluated: LocationEvaluation, conditions: Conditions, now: string): Summary['days'] {
  const tz = conditions.location.timezone;
  const byDay = new Map<string, Period[]>();
  for (const p of evaluated.periods) {
    if (Date.parse(p.end) <= Date.parse(now)) continue;
    const name = dayLabel(p.start, now, tz);
    byDay.set(name, [...(byDay.get(name) ?? []), p]);
  }
  const last = conditions.forecast.at(-1);
  const forecastEnd = last ? new Date(Date.parse(last.time) + HOUR).toISOString() : null;
  return [...byDay.entries()].map(([name, periods]) => {
    const sentences = periods.map((p) => periodSentence(p, conditions));
    const final = periods.at(-1);
    if (
      final &&
      forecastEnd &&
      final.end === forecastEnd &&
      edgeWord(final.end, conditions) !== 'dusk'
    ) {
      sentences.push(`The forecast ends at ${formatClock(forecastEnd, tz)}.`);
    }
    return { name, text: sentences.join(' ') };
  });
}

function daylightDays(conditions: Conditions, now: string): Summary['days'] {
  const tz = conditions.location.timezone;
  const clock = (t: string | null) => (t ? formatClock(t, tz) : 'none');
  return conditions.daylight
    .filter(
      (d) => d.sun === 'risesAndSets' && d.civilDusk && Date.parse(d.civilDusk) > Date.parse(now),
    )
    .map((d) => ({
      name: dayLabel(d.sunrise ?? d.date, now, tz),
      text: `Civil dawn ${clock(d.civilDawn)}, sunrise ${clock(d.sunrise)}, sunset ${clock(d.sunset)}, civil dusk ${clock(d.civilDusk)}.`,
    }));
}

export function summaryModel({ conditions, evaluated, now }: SummaryInput): Summary {
  const tz = conditions.location.timezone;
  if (!evaluated) {
    return {
      headline: 'No limits to compare against yet',
      detail: ['Enter your club’s limits, or your own, to see when conditions are within them.'],
      days: daylightDays(conditions, now),
    };
  }
  if (!evaluated.timeline.hasLimits) {
    return {
      headline: `${evaluated.ruleSet.name} has no limits for ${evaluated.boatClassName} yet`,
      detail: ['Enter your or your club’s limits to see when conditions are within them.'],
      days: daylightDays(conditions, now),
    };
  }
  const window = nextWindow(evaluated.periods, now)?.window;
  return {
    headline: headline(evaluated, now, tz),
    detail: [...deciding(evaluated, conditions, window), ...measurementNote(conditions)],
    days: days(evaluated, conditions, now),
  };
}
