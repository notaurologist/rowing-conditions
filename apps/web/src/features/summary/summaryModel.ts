import { nextWindow } from '@rowing/core';
import type { Conditions } from '../../lib/api.ts';
import type { LocationEvaluation } from '../timeline/evaluateLocation.ts';
import { dayLabel, formatClock } from '../timeline/periodCopy.ts';

// The words at the top of the main screen: the answer and how sure. Neutral wording only:
// "within" or "outside" the limits, never a verdict.

export interface Summary {
  headline: string;
  detail: string[];
  caveat?: string; // with every answer: forecasts can be wrong, and the rower decides (decision 0020)
  others: string[]; // one sentence per other attached rule set
}

export interface SummaryInput {
  conditions: Conditions;
  evaluated: LocationEvaluation | null; // the selected rule set
  alongside?: readonly LocationEvaluation[]; // every attached rule set, including the selected one
  now: string;
}

export const CAVEAT = 'Forecasts can be wrong. Check conditions on the water before you go.';

function dayPhrase(time: string, now: string, timeZone: string | null): string {
  const label = dayLabel(time, now, timeZone);
  if (label === 'Today' || label === 'Tomorrow') return label.toLowerCase();
  return `on ${new Date(time).toLocaleDateString('en-US', { timeZone: timeZone ?? undefined, weekday: 'long' })}`;
}

// The selected rule set is named just above the headline, so only the others name theirs here.
function headline(
  evaluated: LocationEvaluation,
  now: string,
  timeZone: string | null,
  named = false,
): string {
  const limits = named ? `${evaluated.ruleSet.name}’s limits` : 'limits';
  // A within window first; failing that, a probable one from a forecast the app doubts (0020).
  const sure = nextWindow(evaluated.periods, now);
  const next = sure ?? nextWindow(evaluated.periods, now, 'probablyWithin');
  if (!next) {
    const unsure = evaluated.periods.some(
      (p) => p.status === 'unknown' && Date.parse(p.end) > Date.parse(now),
    );
    return unsure
      ? `No hours known to be within ${limits} from dawn to dusk in the next 48 hours`
      : `No hours within ${limits} from dawn to dusk in the next 48 hours`;
  }
  const status = sure ? 'Within' : 'Probably within';
  const { window } = next;
  const clock = (t: string) => formatClock(t, timeZone);
  if (Date.parse(window.start) <= Date.parse(now)) {
    const sameDay = dayLabel(window.end, now, timeZone) === dayLabel(now, now, timeZone);
    return `${status} ${limits} now, until ${sameDay ? '' : `${dayPhrase(window.end, now, timeZone)} `}${clock(window.end)}`;
  }
  return `${status} ${limits} ${dayPhrase(window.start, now, timeZone)}, ${clock(window.start)} to ${clock(window.end)}`;
}

// Why a probable window is only probable (decision 0020).
function doubtNote(evaluated: LocationEvaluation, now: string): string[] {
  if (nextWindow(evaluated.periods, now)) return [];
  if (!nextWindow(evaluated.periods, now, 'probablyWithin')) return [];
  return ['The flow forecast doesn’t match the gauge.'];
}

// The other rule sets in a sentence each, so a glance shows where the clubs differ.
function others(
  evaluated: LocationEvaluation,
  alongside: readonly LocationEvaluation[],
  now: string,
  timeZone: string | null,
): string[] {
  return alongside
    .filter((e) => e.ruleSet.id !== evaluated.ruleSet.id)
    .map((e) => {
      const boatClass = e.ruleSet.boatClasses.length > 1 ? ` (${e.boatClassName})` : '';
      return e.timeline.hasLimits
        ? `${headline(e, now, timeZone, true)}${boatClass}.`
        : `${e.ruleSet.name} has no limits for ${e.boatClassName} yet.`;
    });
}

export function summaryModel({ conditions, evaluated, alongside, now }: SummaryInput): Summary {
  const tz = conditions.location.timezone;
  if (!evaluated) {
    return {
      headline: 'No limits to compare against yet',
      detail: ['Enter your club’s limits, or your own, to see when conditions are within them.'],
      others: [],
    };
  }
  const rest = others(evaluated, alongside ?? [], now, tz);
  if (!evaluated.timeline.hasLimits) {
    return {
      headline: `${evaluated.ruleSet.name} has no limits for ${evaluated.boatClassName} yet`,
      detail: ['Enter your or your club’s limits to see when conditions are within them.'],
      others: rest,
    };
  }
  return {
    headline: headline(evaluated, now, tz),
    detail: doubtNote(evaluated, now),
    caveat: CAVEAT,
    others: rest,
  };
}
