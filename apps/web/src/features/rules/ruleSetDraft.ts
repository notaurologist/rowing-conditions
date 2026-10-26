import {
  type DisplaySystem,
  displayUnits,
  entryFromThreshold,
  type GaugeRef,
  type LimitWording,
  type Metric,
  RuleSet,
  ratioScaleMetrics,
  roundHalfAwayFromZero,
  type SavedLocation,
  type Threshold,
  thresholdFromEntry,
  type Unit,
  unitDecimals,
} from '@rowing/core';
import { unitSymbol } from '../../lib/format.ts';
import { newId } from '../location-setup/newLocation.ts';

// The rule set editor's form state: what the user typed, as strings, until it is checked and
// turned into a RuleSet. Checking gives plain-language errors keyed by field, so the form can
// put each next to its input. There are no default limit values (PRODUCT.md, "No default
// thresholds that imply safety").

export interface LimitDraft {
  id: string;
  metric: Exclude<Metric, 'windDirection'>;
  wording: LimitWording;
  value: string;
  unit: Unit;
  boatClassIds: string[]; // none picked: every boat class
}

export interface RuleSetDraft {
  id: string;
  name: string;
  boatClasses: { id: string; name: string }[];
  limits: LimitDraft[];
  daylight: { enabled: boolean; before: string; after: string };
  flowGaugeRef: GaugeRef | '';
}

/** Field keys: name, classes, class:<id>, limit:<id>, daylight.before, daylight.after, form. */
export type DraftErrors = Record<string, string>;

export type DraftCheck = { ok: true; ruleSet: RuleSet } | { ok: false; errors: DraftErrors };

export function emptyDraft(): RuleSetDraft {
  return {
    id: newId(),
    name: '',
    boatClasses: [{ id: newId(), name: 'All boats' }],
    limits: [],
    daylight: { enabled: false, before: '', after: '' },
    flowGaugeRef: '',
  };
}

export function addLimit(
  draft: RuleSetDraft,
  metric: LimitDraft['metric'],
  units: DisplaySystem,
): RuleSetDraft {
  const limit: LimitDraft = {
    id: newId(),
    metric,
    wording: 'atMost',
    value: '',
    unit: displayUnits[units][metric],
    boatClassIds: [],
  };
  return { ...draft, limits: [...draft.limits, limit] };
}

export function draftFromRuleSet(ruleSet: RuleSet): RuleSetDraft {
  return {
    id: ruleSet.id,
    name: ruleSet.name,
    boatClasses: ruleSet.boatClasses.map((c) => ({ ...c })),
    limits: ruleSet.thresholds.map((t) => {
      const entry = entryFromThreshold(t);
      return {
        id: entry.id,
        metric: entry.metric as LimitDraft['metric'],
        wording: entry.wording,
        value: String(entry.value),
        unit: entry.unit,
        boatClassIds: entry.boatClassIds ?? [],
      };
    }),
    daylight: ruleSet.daylight
      ? {
          enabled: true,
          before: String(ruleSet.daylight.minutesBeforeSunrise),
          after: String(ruleSet.daylight.minutesAfterSunset),
        }
      : { enabled: false, before: '', after: '' },
    flowGaugeRef: ruleSet.flowGaugeRef ?? '',
  };
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)$/;
const WHOLE = /^[-+]?\d+$/;

function parseNumber(typed: string): number | null {
  const text = typed.trim().replaceAll(',', '');
  return NUMBER.test(text) ? Number(text) : null;
}

function limitError(limit: LimitDraft, value: number | null): string | null {
  if (value === null) return 'Enter a number.';
  const decimals = unitDecimals[limit.unit];
  if (roundHalfAwayFromZero(value, decimals) !== value) {
    const symbol = unitSymbol(limit.unit);
    return decimals === 0
      ? `${symbol} limits are whole numbers.`
      : `${symbol} limits have at most ${decimals} decimal place${decimals === 1 ? '' : 's'}.`;
  }
  if (ratioScaleMetrics.includes(limit.metric) && value <= 0) return 'Must be more than zero.';
  if (limit.metric === 'precipChance' && value > 100) return 'Rain chance can’t be more than 100%.';
  return null;
}

export function checkDraft(draft: RuleSetDraft): DraftCheck {
  const errors: DraftErrors = {};

  const name = draft.name.trim();
  if (name === '') errors.name = 'Give the rule set a name, such as your club’s.';

  if (draft.boatClasses.length === 0) errors.classes = 'Add at least one boat class.';
  for (const c of draft.boatClasses) {
    if (c.name.trim() === '') errors[`class:${c.id}`] = 'Name this boat class.';
  }
  const classIds = new Set(draft.boatClasses.map((c) => c.id));

  const thresholds: Threshold[] = [];
  for (const limit of draft.limits) {
    const value = parseNumber(limit.value);
    const error = limitError(limit, value);
    if (error || value === null) {
      errors[`limit:${limit.id}`] = error ?? 'Enter a number.';
      continue;
    }
    thresholds.push(
      thresholdFromEntry({
        id: limit.id,
        metric: limit.metric,
        wording: limit.wording,
        value,
        unit: limit.unit,
        boatClassIds: limit.boatClassIds.filter((id) => classIds.has(id)),
      }),
    );
  }

  let daylight: RuleSet['daylight'];
  if (draft.daylight.enabled) {
    const before = draft.daylight.before.trim();
    const after = draft.daylight.after.trim();
    if (!WHOLE.test(before)) errors['daylight.before'] = 'Enter whole minutes.';
    if (!WHOLE.test(after)) errors['daylight.after'] = 'Enter whole minutes.';
    daylight = { minutesBeforeSunrise: Number(before), minutesAfterSunset: Number(after) };
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const hasFlowLimit = thresholds.some((t) => t.metric === 'flow');
  const result = RuleSet.safeParse({
    id: draft.id,
    name,
    boatClasses: draft.boatClasses.map((c) => ({ id: c.id, name: c.name.trim() })),
    thresholds,
    ...(daylight ? { daylight } : {}),
    ...(hasFlowLimit && draft.flowGaugeRef ? { flowGaugeRef: draft.flowGaugeRef } : {}),
  });
  // The checks above cover every rule the schema has; this is the backstop if they drift.
  if (!result.success) {
    return { ok: false, errors: { form: result.error.issues.map((i) => i.message).join('; ') } };
  }
  return { ok: true, ruleSet: result.data };
}

export function upsertRuleSet(ruleSets: readonly RuleSet[], ruleSet: RuleSet): RuleSet[] {
  return ruleSets.some((r) => r.id === ruleSet.id)
    ? ruleSets.map((r) => (r.id === ruleSet.id ? ruleSet : r))
    : [...ruleSets, ruleSet];
}

export function attachRuleSet(
  locations: readonly SavedLocation[],
  locationId: string,
  ruleSetId: string,
): SavedLocation[] {
  return locations.map((l) =>
    l.id === locationId && !l.ruleSetIds.includes(ruleSetId)
      ? { ...l, ruleSetIds: [...l.ruleSetIds, ruleSetId] }
      : l,
  );
}

export function removeRuleSet(
  ruleSets: readonly RuleSet[],
  locations: readonly SavedLocation[],
  ruleSetId: string,
): { ruleSets: RuleSet[]; locations: SavedLocation[] } {
  return {
    ruleSets: ruleSets.filter((r) => r.id !== ruleSetId),
    locations: locations.map((l) => ({
      ...l,
      ruleSetIds: l.ruleSetIds.filter((id) => id !== ruleSetId),
    })),
  };
}
