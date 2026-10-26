import type { Metric, Unit } from '../types/measurement.ts';
import type { Threshold } from '../types/rules.ts';
import { displayValue, toInternal } from '../units/units.ts';

// A limit as a person enters it: the club's wording, the number they type, and its unit. The
// rule set editor (web now, native later) works in entries; storage and evaluation work in
// thresholds. Validation stays in the Threshold and RuleSet schemas.

export type LimitWording = 'atMost' | 'below' | 'atLeast' | 'above';

// "at most 15 mph" includes 15; "below 15 mph" doesn't (DOMAIN.md, "A value exactly at the limit").
export const WORDING: Record<LimitWording, Pick<Threshold, 'comparison' | 'boundary'>> = {
  atMost: { comparison: 'max', boundary: 'inclusive' },
  below: { comparison: 'max', boundary: 'exclusive' },
  atLeast: { comparison: 'min', boundary: 'inclusive' },
  above: { comparison: 'min', boundary: 'exclusive' },
};

// Every metric a limit can be set on. Wind direction has none until directional rules arrive.
export const LIMIT_METRICS: readonly Metric[] = [
  'flow',
  'gaugeHeight',
  'waterTemp',
  'airTemp',
  'combinedTempF',
  'windSpeed',
  'windGust',
  'precipChance',
];

export interface LimitEntry {
  id: string;
  metric: Metric;
  wording: LimitWording;
  value: number; // as typed, in `unit`
  unit: Unit;
  boatClassIds?: string[]; // omitted or empty: every boat class in the rule set
}

export function thresholdFromEntry(entry: LimitEntry): Threshold {
  return {
    id: entry.id,
    metric: entry.metric,
    ...WORDING[entry.wording],
    value: toInternal(entry.metric, entry.value, entry.unit),
    enteredUnit: entry.unit,
    ...(entry.boatClassIds && entry.boatClassIds.length > 0
      ? { boatClassIds: entry.boatClassIds }
      : {}),
  };
}

export function entryFromThreshold(t: Threshold): LimitEntry {
  const wording = (Object.keys(WORDING) as LimitWording[]).find(
    (w) => WORDING[w].comparison === t.comparison && WORDING[w].boundary === t.boundary,
  ) as LimitWording;
  return {
    id: t.id,
    metric: t.metric,
    wording,
    value: displayValue(t.metric, t.value, t.enteredUnit),
    unit: t.enteredUnit,
    ...(t.boatClassIds ? { boatClassIds: t.boatClassIds } : {}),
  };
}
