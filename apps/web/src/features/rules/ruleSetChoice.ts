import type { GaugeRef, RuleSet, SavedLocation } from '@rowing/core';
import type { Preferences } from '../../lib/storage.ts';

// Which of a location's rule sets the answer and chart follow, and which boat class each is
// evaluated for. Every attached rule set still gets its own status beside the selected one.

export interface RuleSetChoice {
  ruleSet: RuleSet;
  boatClassId: string;
  selected: boolean;
}

export function attachedRuleSets(
  location: SavedLocation,
  ruleSets: readonly RuleSet[],
  preferences: Preferences,
): RuleSetChoice[] {
  const attached = location.ruleSetIds
    .map((id) => ruleSets.find((r) => r.id === id))
    .filter((r): r is RuleSet => r !== undefined);
  const stored = preferences.selectedRuleSetIds?.[location.id];
  const selectedId = attached.some((r) => r.id === stored) ? stored : attached[0]?.id;
  return attached.map((ruleSet) => {
    const chosen = preferences.boatClassIds?.[ruleSet.id];
    const boatClass =
      ruleSet.boatClasses.find((c) => c.id === chosen) ??
      (ruleSet.boatClasses[0] as RuleSet['boatClasses'][0]);
    return { ruleSet, boatClassId: boatClass.id, selected: ruleSet.id === selectedId };
  });
}

export function selectRuleSet(
  preferences: Preferences,
  locationId: string,
  ruleSetId: string,
): Preferences {
  return {
    ...preferences,
    selectedRuleSetIds: { ...preferences.selectedRuleSetIds, [locationId]: ruleSetId },
  };
}

export function chooseBoatClass(
  preferences: Preferences,
  ruleSetId: string,
  boatClassId: string,
): Preferences {
  return {
    ...preferences,
    boatClassIds: { ...preferences.boatClassIds, [ruleSetId]: boatClassId },
  };
}

// The API takes at most this many (MAX_FLOW_GAUGES in apps/api/src/app.ts). A rule set whose gauge
// is past the cap gets no flow series, so its flow limit shows as unknown rather than failing.
const MAX_FLOW_GAUGES = 5;

/** The gauges the attached rule sets name for their flow limits, each once. */
export function flowGaugeRefs(choices: readonly RuleSetChoice[]): GaugeRef[] {
  const refs = choices.flatMap((c) => (c.ruleSet.flowGaugeRef ? [c.ruleSet.flowGaugeRef] : []));
  return [...new Set(refs)].slice(0, MAX_FLOW_GAUGES);
}
