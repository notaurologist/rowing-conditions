import {
  evaluateTimeline,
  type ForecastPoint,
  findLimitingFactor,
  findPeriods,
  forecastForRuleSet,
  type GaugeRef,
  type HourResult,
  type LimitingFactor,
  type Period,
  type RuleSet,
  type SavedLocation,
  type TimelineInput,
  type TimelineResult,
} from '@rowing/core';
import type { Conditions } from '../../lib/api.ts';
import { tidyGaugeName } from '../../lib/format.ts';

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
  // The forecast as the rule set sees it, with flow from its own gauge if it names one. The
  // chart and summary read this, so they show the flow the rule set is evaluated against.
  forecast: ForecastPoint[];
  flowGauge: { ref: GaugeRef; name: string } | null; // the gauge the rule set names, if any
}

// "Connecticut River at Montague City, MA", or "USGS 01170500" when the name didn't load.
function gaugeName(ref: GaugeRef, name: string | undefined): string {
  if (name) return tidyGaugeName(name);
  const id = ref.slice(ref.indexOf(':') + 1);
  return ref.startsWith('usgs:') ? `USGS ${id.replace(/^USGS-/, '')}` : `NWPS ${id}`;
}

// Evaluates the forecast once per rule set, for the answer, the chart and the period list. Uses
// the given boat class, or the rule set's first. Null without a rule set.
export function evaluateLocation(
  conditions: Conditions,
  location: SavedLocation,
  ruleSet: RuleSet | undefined,
  now: string,
  boatClassId?: string,
): LocationEvaluation | null {
  const boatClass =
    ruleSet?.boatClasses.find((c) => c.id === boatClassId) ?? ruleSet?.boatClasses[0];
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
  const ref = ruleSet.flowGaugeRef;
  const series = conditions.flowSeries.find((s) => s.gaugeRef === ref);
  const timeline = evaluateTimeline(input);
  return {
    ruleSet,
    boatClassName: boatClass.name,
    timeline,
    limiting: timeline.hasLimits ? findLimitingFactor(input, timeline) : null,
    periods: findPeriods(timeline.hours, { ruleSet, lat: location.lat, lon: location.lon }),
    evaluation: { ruleSet, boatClassId: boatClass.id, hours: timeline.hours },
    forecast: forecastForRuleSet(input),
    flowGauge: ref ? { ref, name: gaugeName(ref, series?.name) } : null,
  };
}
