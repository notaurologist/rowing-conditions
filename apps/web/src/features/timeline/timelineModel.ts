import {
  type ChartMetric,
  combinedTempF,
  type DaylightTimes,
  type DisplaySystem,
  displayUnits,
  displayValue,
  type EvaluationStatus,
  type ForecastPoint,
  fromInternal,
  type HourResult,
  hourLightLevel,
  type LightLevel,
  type Metric,
  type RuleSet,
  type Threshold,
  type Unit,
} from '@rowing/core';
import { formatNumber, metricName, unitSymbol } from '../../lib/format.ts';

// Turns the hourly forecast into what the timeline chart draws, independent of rendering, so
// the chart components can be tested with fixture data.

const HOUR = 3_600_000;

export interface SeriesPoint {
  time: string;
  value: number | null; // null draws a gap
}

export interface Series {
  metric: Metric;
  label: string;
  points: SeriesPoint[];
}

export interface LimitLine {
  thresholdId: string;
  metric: Metric;
  value: number; // in the chart's unit, for placing the line
  label: string; // as entered, e.g. "Club A gusts: at most 15 mph"
}

export interface TimelineHour {
  time: string;
  light: LightLevel;
  status?: EvaluationStatus; // absent when no rule set is selected
}

export interface LightBand {
  light: LightLevel;
  start: string;
  end: string; // exclusive
}

export interface TimelineModel {
  metric: ChartMetric;
  unit: string;
  series: Series[];
  limits: LimitLine[];
  hours: TimelineHour[];
  lightBands: LightBand[];
  domain: [number, number];
  flowSource: { kind: 'forecast' | 'observation'; asOf: string } | null;
}

export interface TimelineEvaluation {
  ruleSet: RuleSet;
  boatClassId: string;
  hours: HourResult[];
}

export interface TimelineModelInput {
  forecast: ForecastPoint[];
  metric: ChartMetric;
  units: DisplaySystem;
  lat: number;
  lon: number;
  evaluation?: TimelineEvaluation | undefined;
  // Exact civil dawn, sunrise, sunset and civil dusk. Civil twilight lasts about 30 minutes,
  // so hourly light levels alone often skip it; these times draw it where it falls.
  daylight?: DaylightTimes[] | undefined;
}

const SERIES_METRICS: Record<ChartMetric, Metric[]> = {
  flow: ['flow'],
  gaugeHeight: ['gaugeHeight'],
  wind: ['windSpeed', 'windGust'],
  waterTemp: ['waterTemp'],
  airTemp: ['airTemp'],
  combinedTempF: ['combinedTempF'],
  precipChance: ['precipChance'],
};

const SERIES_LABELS: Partial<Record<Metric, string>> = { windSpeed: 'Wind', windGust: 'Gusts' };

// Metrics that can't go below zero, so the axis starts at zero.
const FLOORED_AT_ZERO: ChartMetric[] = ['flow', 'wind', 'precipChance'];

export function limitWording(
  comparison: Threshold['comparison'],
  boundary: Threshold['boundary'],
): string {
  if (comparison === 'max') return boundary === 'inclusive' ? 'at most' : 'below';
  return boundary === 'inclusive' ? 'at least' : 'above';
}

function chartUnit(metric: ChartMetric, units: DisplaySystem): Unit {
  return displayUnits[units][metric === 'wind' ? 'windSpeed' : metric];
}

function valueAt(point: ForecastPoint, metric: Metric, unit: Unit): number | null {
  if (metric === 'combinedTempF') {
    const { airTemp, waterTemp } = point.values;
    return typeof airTemp === 'number' && typeof waterTemp === 'number'
      ? combinedTempF(airTemp, waterTemp)
      : null;
  }
  const value = point.values[metric];
  return typeof value === 'number' ? displayValue(metric, value, unit) : null;
}

function lightBands(hours: TimelineHour[]): LightBand[] {
  const bands: LightBand[] = [];
  for (const hour of hours) {
    const end = new Date(Date.parse(hour.time) + HOUR).toISOString();
    const last = bands.at(-1);
    if (last && last.light === hour.light && last.end === hour.time) last.end = end;
    else bands.push({ light: hour.light, start: hour.time, end });
  }
  return bands;
}

// Each event starts the light level that follows it.
const EVENTS = [
  ['civilDawn', 'twilight'],
  ['sunrise', 'daylight'],
  ['sunset', 'twilight'],
  ['civilDusk', 'dark'],
] as const;
// The level before each event, for the start of the chart.
const BEFORE: Record<(typeof EVENTS)[number][0], LightLevel> = {
  civilDawn: 'dark',
  sunrise: 'twilight',
  sunset: 'daylight',
  civilDusk: 'twilight',
};

// Bands from exact event times, or null when a day doesn't have all four (polar day or night).
function exactLightBands(
  daylight: DaylightTimes[],
  start: string,
  end: string,
): LightBand[] | null {
  const events: { time: number; key: (typeof EVENTS)[number][0]; light: LightLevel }[] = [];
  for (const day of daylight) {
    if (day.sun !== 'risesAndSets') return null;
    for (const [key, light] of EVENTS) {
      const time = day[key];
      if (time === null) return null;
      events.push({ time: Date.parse(time), key, light });
    }
  }
  events.sort((a, b) => a.time - b.time);
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const firstAfter = events.findIndex((e) => e.time > startMs);
  if (firstAfter === -1) return null;
  const previous = events[firstAfter - 1];
  const first = events[firstAfter];
  if (!first) return null;
  let light = previous ? previous.light : BEFORE[first.key];

  const bands: LightBand[] = [];
  let bandStart = startMs;
  for (const event of events.slice(firstAfter)) {
    if (event.time >= endMs) break;
    bands.push({
      light,
      start: new Date(bandStart).toISOString(),
      end: new Date(event.time).toISOString(),
    });
    light = event.light;
    bandStart = event.time;
  }
  bands.push({
    light,
    start: new Date(bandStart).toISOString(),
    end: new Date(endMs).toISOString(),
  });
  return bands;
}

function domainOf(values: number[], metric: ChartMetric): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  const pad = Math.max((max - min) * 0.1, Math.abs(max) * 0.05, 1);
  min -= pad;
  max += pad;
  if (FLOORED_AT_ZERO.includes(metric)) min = Math.max(0, min);
  if (metric === 'precipChance') max = Math.min(100, Math.max(max, 10));
  return [min, max];
}

function flowSourceOf(forecast: ForecastPoint[]): TimelineModel['flowSource'] {
  const provenance = forecast.find((p) => p.provenance.flow)?.provenance.flow;
  return provenance ? { kind: provenance.kind, asOf: provenance.asOf } : null;
}

export function timelineModel(input: TimelineModelInput): TimelineModel {
  const { forecast, metric, units, evaluation } = input;
  const unit = chartUnit(metric, units);

  const series = SERIES_METRICS[metric].map((m) => ({
    metric: m,
    label: SERIES_LABELS[m] ?? metricName(m).replace(/^./, (c) => c.toUpperCase()),
    points: forecast.map((p) => ({ time: p.time, value: valueAt(p, m, unit) })),
  }));

  const limits: LimitLine[] = evaluation
    ? evaluation.ruleSet.thresholds
        .filter(
          (t) =>
            SERIES_METRICS[metric].includes(t.metric) &&
            (t.boatClassIds === undefined || t.boatClassIds.includes(evaluation.boatClassId)),
        )
        .map((t) => {
          const entered = displayValue(t.metric, t.value, t.enteredUnit);
          const what = SERIES_LABELS[t.metric]?.toLowerCase() ?? metricName(t.metric);
          return {
            thresholdId: t.id,
            metric: t.metric,
            value: fromInternal(t.metric, t.value, unit),
            label: `${evaluation.ruleSet.name} ${what}: ${limitWording(t.comparison, t.boundary)} ${formatNumber(entered, t.enteredUnit)} ${unitSymbol(t.enteredUnit)}`,
          };
        })
    : [];

  const statusByTime = new Map(evaluation?.hours.map((h) => [h.time, h]) ?? []);
  const hours: TimelineHour[] = forecast.map((p) => {
    const evaluated = statusByTime.get(p.time);
    return {
      time: p.time,
      light: evaluated?.light ?? hourLightLevel(p.time, input.lat, input.lon),
      ...(evaluated ? { status: evaluated.status } : {}),
    };
  });

  const values = [
    ...series.flatMap((s) => s.points.map((p) => p.value)).filter((v) => v !== null),
    ...limits.map((l) => l.value),
  ];

  return {
    metric,
    unit: unitSymbol(unit),
    series,
    limits,
    hours,
    lightBands:
      (input.daylight && hours.length > 0
        ? exactLightBands(
            input.daylight,
            hours[0]?.time ?? '',
            new Date(Date.parse(hours.at(-1)?.time ?? '') + HOUR).toISOString(),
          )
        : null) ?? lightBands(hours),
    domain: domainOf(values, metric),
    flowSource: metric === 'flow' ? flowSourceOf(forecast) : null,
  };
}
