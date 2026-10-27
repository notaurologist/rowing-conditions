import {
  combinedTempF,
  type DaylightTimes,
  type DisplaySystem,
  displayUnits,
  displayValue,
  type EvaluationStatus,
  type ForecastPoint,
  hourLightLevel,
  type Metric,
  nextWindow,
  type SavedLocation,
  type Threshold,
  temperatureDifference,
  type Unit,
} from '@rowing/core';
import type { Conditions } from '../../lib/api.ts';
import { compassPoint, formatNumber, unitSymbol } from '../../lib/format.ts';
import { type CourseWindWords, courseWindByHour } from '../course/courseWords.ts';
import type { LocationEvaluation } from './evaluateLocation.ts';
import { dayLabel, formatClock } from './periodCopy.ts';

// The rowing meteogram: every element on one 48-hour axis, each in its customary form.
// River flow is a hydrograph, wind a band from sustained speed to gusts with direction arrows,
// air and water temperature lines, rain chance bars. Each limit is a line, and the space
// between the forecast and the limit is filled (Playfair's balance chart). This module turns
// a /conditions response and its evaluation into what the chart draws; it does no rendering.
// Positions along the time axis are in hours from the start of the first forecast hour.

const HOUR = 3_600_000;

export interface MeteogramPoint {
  time: string;
  value: number | null; // display unit; null draws a gap
  // The current hour's value is a measurement and the next hour's a forecast. The chart shows it
  // as the measured dot rather than joining it to the forecast line.
  measured?: true;
}

export interface MeteogramSeries {
  metric: Metric;
  role: 'main' | 'gust' | 'setAside'; // setAside: a doubted flow forecast, dashed (#144, decision 0020)
  points: MeteogramPoint[];
}

export interface MeteogramLimit {
  thresholdId: string;
  metric: Metric;
  comparison: Threshold['comparison'];
  value: number; // in the row's display unit
  label: string; // "limit 3,100", "gust limit 15"
}

export type RowId =
  | 'flow'
  | 'gaugeHeight'
  | 'wind'
  | 'airTemp'
  | 'waterTemp'
  | 'combinedTempF'
  | 'rain';

export interface MeteogramRow {
  id: RowId;
  label: string;
  sub: string; // unit and limit in words, under the label
  kind: 'line' | 'band' | 'bars' | 'message';
  message?: string;
  unit: string;
  series: MeteogramSeries[];
  limits: MeteogramLimit[];
  domain: [number, number];
  arrows?: { index: number; degrees: number }[];
  // offScale: the measurement is far outside the forecast's range and is drawn at the edge.
  observed?: { value: number; at: number; label: string; offScale?: 'above' | 'below' };
  readouts: string[]; // one per hour
}

export interface StatusStrip {
  ruleSetId: string;
  name: string;
  sub: string; // the boat class when the rule set has several, else "all limits"
  selected: boolean;
  spans: { from: number; to: number; status: EvaluationStatus }[]; // empty: no limits to compare
}

export interface MeteogramModel {
  hours: { time: string; label: string; light: string; fog: FogWords }[]; // light: Twilight, then night
  course?: { words: CourseWindWords[]; notes?: string | undefined }; // wind along the saved course, per hour
  // A set-aside flow forecast's evidence, in display units: what it had for the reading's hour.
  flowSetAside?: { forecast: string; measured: string; hour: string };
  rows: MeteogramRow[];
  light: { from: number; to: number; light: 'twilight' | 'night' }[];
  // One strip per attached rule set, in the location's order. The selected one also drives the
  // limit lines and windows.
  statuses: StatusStrip[];
  windows: { from: number; to: number; label: string; probable?: boolean }[]; // probable: dashed
  days: { at: number; label: string }[];
  ticks: { at: number; label: string }[];
  defaultHour: number;
}

export interface MeteogramInput {
  conditions: Conditions;
  location: SavedLocation;
  units: DisplaySystem;
  now: string;
  evaluated: LocationEvaluation | null;
  // Every attached rule set's evaluation, for the status strips. Omitted: just `evaluated`.
  alongside?: readonly LocationEvaluation[];
}

type RowSpec = {
  id: RowId;
  label: string;
  metrics: Metric[];
  unitMetric: Exclude<Metric, 'windDirection'>;
};

const fmt = (value: number, unit: Unit) => formatNumber(value, unit);
// Window labels closer than this share of the timeline would overlap; the later one is left out.
const LABEL_GAP = 0.2;

function valueAt(point: ForecastPoint, metric: Metric, unit: Unit): number | null {
  if (metric === 'combinedTempF') {
    const { airTemp, waterTemp } = point.values;
    return typeof airTemp === 'number' && typeof waterTemp === 'number'
      ? combinedTempF(airTemp, waterTemp)
      : null;
  }
  const v = point.values[metric];
  return typeof v === 'number' ? displayValue(metric, v, unit) : null;
}

function hasValues(forecast: readonly ForecastPoint[], metric: Metric): boolean {
  return forecast.some(
    (p) =>
      valueAt(p, metric, displayUnits.us[metric === 'windDirection' ? 'windSpeed' : metric]) !==
      null,
  );
}

// The current hour holds a measurement (withLatestMeasurements in the API) and the next a forecast.
function measuredThenForecast(forecast: readonly ForecastPoint[], metric: Metric): boolean {
  return (
    forecast[0]?.provenance[metric]?.kind === 'observation' &&
    forecast[1]?.provenance[metric]?.kind === 'forecast'
  );
}

// The scale for a row: data, limits and the measurement all fit, padded so lines clear the edges.
function domainOf(values: number[], floorAtZero: boolean, headroom = 1): [number, number] {
  if (values.length === 0) return [0, 1];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.12, Math.abs(hi) * 0.02, 1);
  lo -= pad;
  hi = hi + pad + (hi - lo) * (headroom - 1);
  if (floorAtZero) lo = Math.max(0, lo);
  return niceDomain(lo, hi);
}

// Widens a scale to round steps of 1, 2 or 5, so its top and bottom labels read as 25,000, not 22,177.
function niceDomain(lo: number, hi: number): [number, number] {
  const rough = (hi - lo) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / magnitude;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * magnitude;
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

// "2 PM – 6:20 PM" becomes "2 – 6:20 PM" when both ends share AM or PM.
function compactRange(start: string, end: string, timeZone: string | null): string {
  const a = formatClock(start, timeZone);
  const b = formatClock(end, timeZone);
  const suffix = (t: string) => t.slice(-2);
  return suffix(a) === suffix(b) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}

function marginWords(value: number, limit: MeteogramLimit, unit: Unit): string {
  const gap = Math.abs(value - limit.value);
  const text = fmt(gap, unit);
  if (limit.comparison === 'max') return value <= limit.value ? `${text} under` : `${text} over`;
  return value >= limit.value ? `${text} above` : `${text} below`;
}

// Twilight and night spans from the exact civil dawn, sunrise, sunset and civil dusk, so a
// half-hour twilight isn't lost between hourly samples. Falls back to hourly light levels when
// a day has no sunrise or sunset (polar day or night).
const EVENTS = [
  ['civilDawn', 'twilight'],
  ['sunrise', 'daylight'],
  ['sunset', 'twilight'],
  ['civilDusk', 'night'],
] as const;
type Light = 'daylight' | 'twilight' | 'night';
const BEFORE: Record<(typeof EVENTS)[number][0], Light> = {
  civilDawn: 'night',
  sunrise: 'twilight',
  sunset: 'daylight',
  civilDusk: 'twilight',
};

function lightSpans(
  daylight: readonly DaylightTimes[],
  start: number,
  hours: number,
  lat: number,
  lon: number,
) {
  const exact = (() => {
    const events: { time: number; key: (typeof EVENTS)[number][0]; light: Light }[] = [];
    for (const day of daylight) {
      if (day.sun !== 'risesAndSets') return null;
      for (const [key, light] of EVENTS) {
        const time = day[key];
        if (time === null) return null;
        events.push({ time: Date.parse(time), key, light });
      }
    }
    events.sort((a, b) => a.time - b.time);
    const firstAfter = events.findIndex((e) => e.time > start);
    const first = events[firstAfter];
    if (!first) return null;
    let light: Light = events[firstAfter - 1]?.light ?? BEFORE[first.key];
    const spans: { from: number; to: number; light: Light }[] = [];
    let from = 0;
    for (const e of events.slice(firstAfter)) {
      const at = (e.time - start) / HOUR;
      if (at >= hours) break;
      spans.push({ from, to: at, light });
      light = e.light;
      from = at;
    }
    spans.push({ from, to: hours, light });
    return spans;
  })();
  const spans =
    exact ??
    Array.from({ length: hours }, (_, i) => {
      const level = hourLightLevel(new Date(start + i * HOUR).toISOString(), lat, lon);
      return { from: i, to: i + 1, light: (level === 'dark' ? 'night' : level) as Light };
    });
  return spans;
}

// The light levels an hour passes through, in words, so light isn't conveyed by shading alone.
// The NWS forecaster's fog call in words (#42). Context only: it never affects status. An hour
// the forecast doesn't cover is unknown, never "no fog".
export interface FogWords {
  state: 'fog' | 'none' | 'unknown';
  text: string; // "Patchy fog", "No fog forecast", "Fog forecast unknown"
}

const FOG_COVERAGE: Record<string, string> = {
  patchy: 'Patchy fog',
  areas: 'Areas of fog',
  widespread: 'Widespread fog',
  isolated: 'Isolated fog',
  scattered: 'Scattered fog',
  slight_chance: 'Slight chance of fog',
  chance: 'Chance of fog',
  likely: 'Fog likely',
  definite: 'Fog',
  unspecified: 'Fog',
};

// Air temperature above the dew point, an input to fog (#42). Shown as a number only: the app
// doesn't turn it into a fog forecast.
export function dewPointGapWords(gapC: number, unit: 'degC' | 'degF'): string {
  const gap = temperatureDifference(gapC, unit);
  if (gap <= 0) return 'at dew point';
  return `${formatNumber(gap, unit)}° above dew point`;
}

export function fogWords(fog: string | null | undefined): FogWords {
  if (fog === undefined) return { state: 'unknown', text: 'Fog forecast unknown' };
  if (fog === null) return { state: 'none', text: 'No fog forecast' };
  return { state: 'fog', text: FOG_COVERAGE[fog] ?? `Fog (${fog.replaceAll('_', ' ')})` };
}

function hourLight(spans: readonly { from: number; to: number; light: Light }[], i: number) {
  const levels = spans.filter((s) => s.from < i + 1 && s.to > i).map((s) => s.light);
  const words = levels.filter((l, k) => l !== levels[k - 1]).join(', then ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function meteogramModel(input: MeteogramInput): MeteogramModel {
  const { conditions, location, units, now, evaluated } = input;
  const alongside = input.alongside ?? (evaluated ? [evaluated] : []);
  // Flow comes from the selected rule set's gauge when it names one, the same series it is
  // evaluated against. Every other metric is the same in both.
  const forecast = evaluated?.forecast ?? conditions.forecast;
  const flowGauge = evaluated?.flowGauge ?? null;
  // A flow forecast set aside for disagreeing with the gauge (#82), for whichever gauge the flow
  // row shows. Drawn dashed and worded as not matching the gauge; evaluation counts it only as a doubted value
  // (probably within or outside, decision 0020).
  const setAside = conditions.flowSetAside.find(
    (f) => f.gaugeRef === (flowGauge?.ref ?? location.gaugeRef),
  );
  const timeZone = conditions.location.timezone;
  const n = forecast.length;
  const start = n > 0 ? Date.parse(forecast[0]?.time ?? now) : Date.parse(now);
  const at = (time: string) => (Date.parse(time) - start) / HOUR;

  const thresholds = evaluated?.timeline.hasLimits
    ? evaluated.ruleSet.thresholds.filter(
        (t) =>
          t.boatClassIds === undefined || t.boatClassIds.includes(evaluated.evaluation.boatClassId),
      )
    : [];

  const hasGauge = conditions.gauge !== undefined || location.gaugeRef !== undefined;
  const specs: RowSpec[] = [];
  specs.push({ id: 'flow', label: 'River flow', metrics: ['flow'], unitMetric: 'flow' });
  if (thresholds.some((t) => t.metric === 'gaugeHeight')) {
    specs.push({
      id: 'gaugeHeight',
      label: 'Gauge height',
      metrics: ['gaugeHeight'],
      unitMetric: 'gaugeHeight',
    });
  }
  specs.push({
    id: 'wind',
    label: 'Wind',
    metrics: ['windSpeed', 'windGust'],
    unitMetric: 'windSpeed',
  });
  specs.push({
    id: 'airTemp',
    label: 'Air temperature',
    metrics: ['airTemp'],
    unitMetric: 'airTemp',
  });
  // Water temperature without values is shown only when a limit needs it, to explain unknowns.
  const waterLimit = thresholds.some(
    (t) => t.metric === 'waterTemp' || t.metric === 'combinedTempF',
  );
  if (hasGauge && (waterLimit || hasValues(forecast, 'waterTemp')))
    specs.push({
      id: 'waterTemp',
      label: 'Water temperature',
      metrics: ['waterTemp'],
      unitMetric: 'waterTemp',
    });
  if (thresholds.some((t) => t.metric === 'combinedTempF')) {
    specs.push({
      id: 'combinedTempF',
      label: 'Air + water',
      metrics: ['combinedTempF'],
      unitMetric: 'combinedTempF',
    });
  }
  specs.push({
    id: 'rain',
    label: 'Rain chance',
    metrics: ['precipChance'],
    unitMetric: 'precipChance',
  });

  const nowAt = Math.max(0, at(now));
  const current = (metric: Metric) => {
    // A named gauge's latest measurement is in its first hour (withLatestMeasurements).
    if (metric === 'flow' && flowGauge) {
      const first = forecast[0];
      const provenance = first?.provenance.flow;
      const value = first?.values.flow;
      return provenance?.kind === 'observation' && typeof value === 'number'
        ? { metric, value, observedAt: provenance.asOf }
        : undefined;
    }
    return conditions.current.find((r) => r.metric === metric);
  };

  const rows: MeteogramRow[] = specs.map((spec) => {
    const unit = displayUnits[units][spec.unitMetric];
    const symbol = unitSymbol(unit);
    const empty = {
      series: [],
      limits: [],
      domain: [0, 1] as [number, number],
      readouts: forecast.map(() => ''),
      unit: symbol,
    };

    if (spec.id === 'flow' && !hasGauge && !flowGauge) {
      return {
        ...empty,
        id: spec.id,
        label: spec.label,
        sub: '',
        kind: 'message',
        message: 'No gauge for this location (weather only).',
      };
    }
    if (!spec.metrics.some((m) => hasValues(forecast, m))) {
      const message =
        spec.id === 'waterTemp'
          ? 'Not measured at this gauge.'
          : spec.id === 'flow' && flowGauge
            ? `No flow values from ${flowGauge.name}.`
            : 'No forecast values.';
      return { ...empty, id: spec.id, label: spec.label, sub: '', kind: 'message', message };
    }

    const series: MeteogramSeries[] = spec.metrics
      .filter((m) => hasValues(forecast, m))
      .map((metric) => ({
        metric,
        role: metric === 'windGust' ? 'gust' : 'main',
        points: forecast.map((p, i) => ({
          time: p.time,
          value: valueAt(p, metric, unit),
          ...(i === 0 && measuredThenForecast(forecast, metric) ? { measured: true as const } : {}),
        })),
      }));
    if (spec.id === 'flow' && setAside) {
      const byTime = new Map(setAside.points.map((p) => [Date.parse(p.time), p.flow]));
      series.push({
        metric: 'flow',
        role: 'setAside',
        points: forecast.map((p) => {
          const flow = byTime.get(Date.parse(p.time));
          return {
            time: p.time,
            value: flow === undefined ? null : displayValue('flow', flow, unit),
          };
        }),
      });
    }

    const limits: MeteogramLimit[] = thresholds
      .filter((t) => spec.metrics.includes(t.metric))
      .map((t) => {
        const value =
          t.metric === 'combinedTempF' ? t.value : displayValue(t.metric, t.value, unit);
        const prefix =
          t.metric === 'windGust'
            ? 'gust limit'
            : t.metric === 'windSpeed'
              ? 'wind limit'
              : 'limit';
        const degree =
          spec.id === 'airTemp' || spec.id === 'waterTemp' || spec.id === 'combinedTempF'
            ? '°'
            : '';
        return {
          thresholdId: t.id,
          metric: t.metric,
          comparison: t.comparison,
          value,
          label: `${prefix} ${fmt(value, unit)}${degree}`,
        };
      });

    const reading =
      spec.id === 'wind'
        ? current('windSpeed')
        : spec.metrics[0]
          ? current(spec.metrics[0])
          : undefined;
    let observed: MeteogramRow['observed'];
    if (reading && reading.value !== null && spec.id !== 'rain' && spec.id !== 'combinedTempF') {
      const value = displayValue(reading.metric, reading.value, unit);
      const clock = formatClock(reading.observedAt, timeZone);
      const degree = spec.id === 'airTemp' || spec.id === 'waterTemp' ? '°' : '';
      const label =
        spec.id === 'wind' && value === 0
          ? 'calm'
          : `${fmt(value, unit)}${degree} measured ${clock}`;
      observed = { value, at: Number(nowAt.toFixed(2)), label };
    }

    const values = series
      .flatMap((s) => s.points.map((p) => p.value))
      .filter((v): v is number => v !== null);
    const base = [...values, ...limits.map((l) => l.value)];
    // A measurement far outside the forecast is drawn at the
    // edge with an arrow instead, so a forecast that missed doesn't flatten into one line.
    if (observed && base.length > 0) {
      const lo = Math.min(...base);
      const hi = Math.max(...base);
      // Off scale: further outside the forecast than half its span or a quarter of its size.
      const slack = Math.max((hi - lo) * 0.5, Math.abs(hi) * 0.25, 1);
      if (observed.value > hi + slack) {
        observed = { ...observed, offScale: 'above', label: `${observed.label} ↑` };
      } else if (observed.value < lo - slack) {
        observed = { ...observed, offScale: 'below', label: `${observed.label} ↓` };
      }
    }
    const domain: [number, number] =
      spec.id === 'rain'
        ? [0, 100]
        : domainOf(
            [...base, ...(observed && !observed.offScale ? [observed.value] : [])],
            spec.id === 'flow' || spec.id === 'wind',
            spec.id === 'wind' ? 1.35 : 1,
          );

    const main = series.find((s) => s.role === 'main');
    const gust = series.find((s) => s.role === 'gust');
    const doubtful = series.find((s) => s.role === 'setAside');
    const gustLimit = limits.find((l) => l.metric === 'windGust');
    const mainLimit = limits.find((l) => l.metric !== 'windGust');
    const direction = forecast.map((p) => p.values.windDirection);

    const readouts = forecast.map((_, i) => {
      const v = main?.points[i]?.value ?? null;
      const measured = main?.points[i]?.measured ? ' measured' : '';
      if (spec.id === 'wind') {
        const g = gust?.points[i]?.value ?? null;
        if (v === null && g === null) return 'no value';
        const parts = [
          `${v === null ? '–' : fmt(v, unit)}${g === null ? '' : `, gusts ${fmt(g, unit)}`} ${symbol}${measured}`,
        ];
        if (gustLimit && g !== null) parts.push(marginWords(g, gustLimit, unit));
        else if (mainLimit && v !== null) parts.push(marginWords(v, mainLimit, unit));
        const d = direction[i];
        if (typeof d === 'number' && v !== 0) parts.push(`from ${compassPoint(d)}`);
        return parts.join(' · ');
      }
      if (v === null) {
        const f = doubtful?.points[i]?.value;
        return typeof f === 'number'
          ? `NWPS ${fmt(f, unit)} ${symbol}, doesn't match gauge`
          : 'no value';
      }
      const amount =
        unit === 'percent' ? `${fmt(v, unit)}%` : `${fmt(v, unit)} ${symbol}${measured}`;
      const parts = [amount];
      if (mainLimit) parts.push(marginWords(v, mainLimit, unit));
      if (spec.id === 'airTemp') {
        const air = forecast[i]?.values.airTemp;
        const dew = forecast[i]?.values.dewPoint;
        if (typeof air === 'number' && typeof dew === 'number')
          parts.push(dewPointGapWords(air - dew, unit === 'degC' ? 'degC' : 'degF'));
      }
      return parts.join(' · ');
    });

    const words = limits.map((l) => l.label).join(', ');
    const sub =
      spec.id === 'rain'
        ? words
          ? `percent, ${words}`
          : 'percent, no limit'
        : spec.id === 'wind'
          ? `${symbol}, sustained to gusts${words ? `; ${words}` : ''}`
          : `${symbol}${words ? `, ${words}` : ''}${spec.id === 'flow' && flowGauge ? ` · gauge: ${flowGauge.name}` : ''}${doubtful ? " · dashed: NWPS forecast, doesn't match the gauge" : ''}`;

    return {
      id: spec.id,
      label: spec.label,
      sub,
      kind: spec.id === 'rain' ? 'bars' : spec.id === 'wind' ? 'band' : 'line',
      unit: symbol,
      series,
      limits,
      domain,
      ...(spec.id === 'wind'
        ? {
            arrows: direction
              .map((d, index) => ({ index, degrees: d ?? 0, ok: typeof d === 'number' }))
              .filter((a) => a.index % 3 === 1 && a.ok)
              .map(({ index, degrees }) => ({ index, degrees })),
          }
        : {}),
      ...(observed ? { observed } : {}),
      readouts,
    };
  });

  // Status spans for each rule set, one per run of hours with the same status.
  const statuses: StatusStrip[] = alongside.map((e) => {
    const byTime = new Map(
      (e.timeline.hasLimits ? e.evaluation.hours : []).map((h) => [h.time, h.status]),
    );
    const spans: StatusStrip['spans'] = [];
    forecast.forEach((p, i) => {
      const s = byTime.get(p.time);
      if (!s) return;
      const last = spans.at(-1);
      if (last && last.status === s && last.to === i) last.to = i + 1;
      else spans.push({ from: i, to: i + 1, status: s });
    });
    return {
      ruleSetId: e.ruleSet.id,
      name: e.ruleSet.name,
      sub: e.ruleSet.boatClasses.length > 1 ? e.boatClassName : 'all limits',
      selected: e.ruleSet.id === evaluated?.ruleSet.id,
      spans,
    };
  });

  const windows: MeteogramModel['windows'] = [];
  if (evaluated?.timeline.hasLimits) {
    // Within windows, and probable ones with dashed brackets (decision 0020). The next is the
    // earliest within window, or the earliest probable one when there's no within window.
    const next =
      nextWindow(evaluated.periods, now) ?? nextWindow(evaluated.periods, now, 'probablyWithin');
    let lastLabeled: number | null = null;
    for (const p of evaluated.periods) {
      if (p.status !== 'within' && p.status !== 'probablyWithin') continue;
      if (Date.parse(p.end) <= Date.parse(now)) continue;
      const probable = p.status === 'probablyWithin';
      const range = compactRange(p.start, p.end, timeZone);
      const isNext = next?.window.start === p.start;
      const day = new Date(p.start).toLocaleDateString('en-US', {
        timeZone: timeZone ?? undefined,
        weekday: 'short',
      });
      const from = Math.max(0, at(p.start));
      // A label starting this close to the previous one would be drawn over it, as when a within
      // window runs straight into a probable one; the bracket alone shows the later window.
      const crowded = !isNext && lastLabeled !== null && from - lastLabeled < n * LABEL_GAP;
      if (!crowded) lastLabeled = from;
      windows.push({
        from,
        to: Math.min(n, at(p.end)),
        label: crowded
          ? ''
          : isNext
            ? `${probable ? 'Probable window' : 'Next window'} · ${range}`
            : `${day} · ${probable ? 'probable · ' : ''}${range}`,
        ...(probable ? { probable: true } : {}),
      });
    }
  }

  const local = (time: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(time).toLocaleString('en-US', { timeZone: timeZone ?? undefined, ...opts });
  const localHour = (time: string) => Number(local(time, { hour: 'numeric', hourCycle: 'h23' }));
  const days: MeteogramModel['days'] = [];
  const ticks: MeteogramModel['ticks'] = [];
  forecast.forEach((p, i) => {
    const h = localHour(p.time);
    if (i === 0 || h === 0)
      days.push({
        at: i,
        label: `${local(p.time, { weekday: 'short' })} ${local(p.time, { day: 'numeric' })}`,
      });
    if (h !== 0 && h % 6 === 0)
      ticks.push({ at: i, label: h === 12 ? 'noon' : formatClock(p.time, timeZone) });
  });

  const light = lightSpans(conditions.daylight, start, n, location.lat, location.lon);
  const hours = forecast.map((p, i) => ({
    time: p.time,
    label: `${dayLabel(p.time, now, timeZone)} ${formatClock(p.time, timeZone)}`,
    light: hourLight(light, i),
    fog: fogWords(p.fog),
  }));
  const firstWindow = windows[0];
  const defaultHour = firstWindow ? Math.min(n - 1, Math.max(0, Math.floor(firstWindow.from))) : 0;

  // Wind along the saved course, out and back or around a loop, per hour (#103, #142).
  const course = location.course
    ? { words: courseWindByHour(location.course, forecast), notes: location.course.notes }
    : undefined;

  const flowUnit = displayUnits[units].flow;
  const flowNote = setAside
    ? {
        forecast: `${fmt(displayValue('flow', setAside.forecastForMeasurement, flowUnit), flowUnit)} ${unitSymbol(flowUnit)}`,
        measured: `${fmt(displayValue('flow', setAside.measured, flowUnit), flowUnit)} ${unitSymbol(flowUnit)}`,
        hour: formatClock(
          new Date(Math.floor(Date.parse(setAside.measuredAt) / HOUR) * HOUR).toISOString(),
          timeZone,
        ),
      }
    : undefined;

  return {
    ...(course ? { course } : {}),
    ...(flowNote ? { flowSetAside: flowNote } : {}),
    hours,
    rows,
    light: light.filter(
      (s): s is { from: number; to: number; light: 'twilight' | 'night' } => s.light !== 'daylight',
    ),
    statuses,
    windows,
    days,
    ticks,
    defaultHour,
  };
}
