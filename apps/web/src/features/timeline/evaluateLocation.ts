import {
  evaluateTimeline,
  findLimitingFactor,
  findPeriods,
  type HourResult,
  type LimitingFactor,
  type Period,
  type RuleSet,
  type SavedLocation,
  type TimelineInput,
  type TimelineResult,
} from '@rowing/core';
import type { Conditions } from '../../lib/api.ts';

export interface TimelineEvaluation {
  ruleSet: RuleSet;
  boatClassId: string;
  hours: HourResult[];
}

export interface LocationEvaluation {
  ruleSet: RuleSet;
  boatClassName: string;
  timeline: TimelineResult;
  limiting: LimitingFactor | null;
  periods: Period[];
  evaluation: TimelineEvaluation;
}

// Evaluates the forecast once for the answer, the chart and the period list. Uses the rule
// set's first boat class until boat class selection arrives (#30). Null without a rule set.
export function evaluateLocation(
  conditions: Conditions,
  location: SavedLocation,
  ruleSet: RuleSet | undefined,
  now: string,
): LocationEvaluation | null {
  const boatClass = ruleSet?.boatClasses[0];
  if (!ruleSet || !boatClass) return null;
  const input: TimelineInput = {
    forecast: conditions.forecast,
    ruleSet,
    boatClassId: boatClass.id,
    lat: location.lat,
    lon: location.lon,
    now,
    flowByGauge: Object.fromEntries(conditions.flowSeries.map((s) => [s.gaugeRef, s.points])),
  };
  const timeline = evaluateTimeline(input);
  return {
    ruleSet,
    boatClassName: boatClass.name,
    timeline,
    limiting: timeline.hasLimits ? findLimitingFactor(input, timeline) : null,
    periods: findPeriods(timeline.hours, { ruleSet, lat: location.lat, lon: location.lon }),
    evaluation: { ruleSet, boatClassId: boatClass.id, hours: timeline.hours },
  };
}
