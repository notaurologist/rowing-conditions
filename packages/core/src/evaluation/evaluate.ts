import { daylightWindowSpan, hourLightLevel } from '../daylight/daylight.ts';
import type { Failure, HourResult, UnknownReason } from '../types/evaluation.ts';
import type { Metric, Qualifier } from '../types/measurement.ts';
import type { ForecastPoint, ValueProvenance } from '../types/readings.ts';
import type { RuleSet, Threshold } from '../types/rules.ts';
import { combinedTempF, displayValue } from '../units/units.ts';

const HOUR = 3_600_000;

type InputMetric = Exclude<Metric, 'combinedTempF'>;

// Maximum age of a value's asOf before it counts as stale. Starting values; tune in M9.
// Weather observations have no agreed limit yet, so they share the 12-hour forecast limit.
export const maxAgeHours: Record<InputMetric, Record<ValueProvenance['kind'], number>> = {
  flow: { observation: 6, forecast: 36 },
  gaugeHeight: { observation: 6, forecast: 36 },
  waterTemp: { observation: 24, forecast: 24 },
  airTemp: { observation: 12, forecast: 12 },
  windSpeed: { observation: 12, forecast: 12 },
  windGust: { observation: 12, forecast: 12 },
  windDirection: { observation: 12, forecast: 12 },
  precipChance: { observation: 12, forecast: 12 },
};

// Readings with these qualifiers are shown but never compared against a limit (#41).
export const disqualifyingQualifiers: readonly Qualifier[] = [
  'iceAffected',
  'equipmentMalfunction',
  'estimated',
];

export interface HourContext {
  ruleSet: RuleSet;
  boatClassId: string;
  lat: number;
  lon: number;
  now: string;
  // Metrics no hour has a source for. Without it, a value absent from this hour is 'missing'.
  unavailableMetrics?: readonly Metric[];
}

type Usable =
  | { ok: true; value: number }
  | { ok: false; metric: InputMetric; reason: UnknownReason };

function usable(point: ForecastPoint, metric: InputMetric, ctx: HourContext): Usable {
  if (ctx.unavailableMetrics?.includes(metric)) return { ok: false, metric, reason: 'noSource' };
  const value = point.values[metric];
  const provenance = point.provenance[metric];
  if (value === null || value === undefined || provenance === undefined) {
    return { ok: false, metric, reason: 'missing' };
  }
  if (provenance.qualifiers?.some((q) => disqualifyingQualifiers.includes(q))) {
    return { ok: false, metric, reason: 'qualified' };
  }
  const age = Date.parse(ctx.now) - Date.parse(provenance.asOf);
  if (age > maxAgeHours[metric][provenance.kind] * HOUR) {
    return { ok: false, metric, reason: 'stale' };
  }
  return { ok: true, value };
}

function inputsOf(threshold: Threshold): InputMetric[] {
  return threshold.metric === 'combinedTempF' ? ['airTemp', 'waterTemp'] : [threshold.metric];
}

function appliesTo(threshold: Threshold, boatClassId: string): boolean {
  return threshold.boatClassIds === undefined || threshold.boatClassIds.includes(boatClassId);
}

function passes(threshold: Threshold, value: number, limit: number): boolean {
  const inclusive = threshold.boundary === 'inclusive';
  if (threshold.comparison === 'max') return inclusive ? value <= limit : value < limit;
  return inclusive ? value >= limit : value > limit;
}

function outsideDaylightWindow(point: ForecastPoint, ctx: HourContext): boolean {
  const window = ctx.ruleSet.daylight;
  if (window === undefined) return false;
  const span = daylightWindowSpan(point.time, ctx.lat, ctx.lon, window);
  if (span.kind === 'allDay') return false;
  if (span.kind === 'none') return true;
  const start = Date.parse(point.time);
  return start + HOUR <= Date.parse(span.start) || start >= Date.parse(span.end);
}

export function evaluateHour(point: ForecastPoint, ctx: HourContext): HourResult {
  const { ruleSet, boatClassId } = ctx;
  if (!ruleSet.boatClasses.some((c) => c.id === boatClassId)) {
    throw new Error(`Rule set ${ruleSet.id} has no boat class ${boatClassId}`);
  }

  const failures: Failure[] = [];
  const unknowns: HourResult['unknowns'] = [];

  for (const threshold of ruleSet.thresholds) {
    if (!appliesTo(threshold, boatClassId)) continue;

    const inputs = inputsOf(threshold).map((metric) => usable(point, metric, ctx));
    const unusable = inputs.find((input) => !input.ok);
    if (unusable && !unusable.ok) {
      unknowns.push({
        thresholdId: threshold.id,
        metric: unusable.metric,
        reason: unusable.reason,
      });
      continue;
    }
    const values = inputs.map((input) => (input.ok ? input.value : Number.NaN));

    const unit = threshold.enteredUnit;
    const value =
      threshold.metric === 'combinedTempF'
        ? combinedTempF(values[0] as number, values[1] as number)
        : displayValue(threshold.metric, values[0] as number, unit);
    const limit = displayValue(threshold.metric, threshold.value, unit);

    if (!passes(threshold, value, limit)) {
      failures.push({
        kind: 'limit',
        thresholdId: threshold.id,
        metric: threshold.metric,
        value,
        limit,
        unit,
      });
    }
  }

  if (outsideDaylightWindow(point, ctx)) failures.push({ kind: 'daylight' });

  const status = failures.length > 0 ? 'outside' : unknowns.length > 0 ? 'unknown' : 'within';
  const light = hourLightLevel(point.time, ctx.lat, ctx.lon);
  return { time: point.time, status, light, failures, unknowns };
}

export interface TimelineInput extends Omit<HourContext, 'unavailableMetrics'> {
  forecast: ForecastPoint[];
  // Flow series by gauge ref, for rule sets that name the gauge their flow limit is measured at.
  flowByGauge?: Partial<Record<string, ForecastPoint[]>>;
}

export interface TimelineResult {
  hours: HourResult[];
  unavailableMetrics: Metric[];
  // False when the rule set has no limits for the boat class and no daylight window; the UI
  // shows its empty state instead of hours that are vacuously within.
  hasLimits: boolean;
}

// Replaces each hour's flow with the named gauge's flow for the same hour, or removes it.
// Never falls back to the location's display gauge.
function withFlowFrom(
  forecast: ForecastPoint[],
  series: ForecastPoint[] | undefined,
): ForecastPoint[] {
  const byTime = new Map((series ?? []).map((p) => [Date.parse(p.time), p]));
  return forecast.map((point) => {
    const { flow: _value, ...values } = point.values;
    const { flow: _provenance, ...provenance } = point.provenance;
    const match = byTime.get(Date.parse(point.time));
    if (match?.provenance.flow !== undefined && match.values.flow !== undefined) {
      return {
        ...point,
        values: { ...values, flow: match.values.flow },
        provenance: { ...provenance, flow: match.provenance.flow },
      };
    }
    return { ...point, values, provenance };
  });
}

export function evaluateTimeline(input: TimelineInput): TimelineResult {
  const { ruleSet, boatClassId } = input;
  const ref = ruleSet.flowGaugeRef;
  const forecast = ref ? withFlowFrom(input.forecast, input.flowByGauge?.[ref]) : input.forecast;

  const applicable = ruleSet.thresholds.filter((t) => appliesTo(t, boatClassId));
  const unavailableMetrics: Metric[] = [];
  for (const metric of applicable.flatMap(inputsOf)) {
    const supplied = forecast.some((p) => p.provenance[metric] !== undefined);
    if (!supplied && !unavailableMetrics.includes(metric)) unavailableMetrics.push(metric);
  }

  const hours = forecast.map((point) => evaluateHour(point, { ...input, unavailableMetrics }));
  const hasLimits = applicable.length > 0 || ruleSet.daylight !== undefined;
  return { hours, unavailableMetrics, hasLimits };
}
