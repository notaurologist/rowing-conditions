// Replays a recorded backtesting case (docs/backtesting.md): what the app would have shown at a
// past time. The case's fixtures stand in for the live sources behind the same interfaces, and
// the app's own getConditions and evaluateTimeline do the rest, so a replay builds its hours the
// way the app does. Backtesting only; never wired into the live app.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type ConditionsResponse,
  distanceKm,
  evaluateHour,
  evaluateTimeline,
  type ForecastPoint,
  forecastForRuleSet,
  type Gauge,
  type GaugeRef,
  type HourResult,
  type Metric,
  type Reading,
  type RuleSet,
  type TimelineResult,
} from '@rowing/core';
import { z } from 'zod';
import {
  type AsosReport,
  type ForecastLead,
  parseAsos,
  parseModeledHistory,
  parsePreviousRuns,
  type WeatherValues,
} from '../adapters/historical/parse.ts';
import { FORECAST_MODEL } from '../adapters/historical/requests.ts';
import type { FetchFn, Logger, SourceResult } from '../adapters/http.ts';
import { STATION_MAX_AGE_HOURS, STATION_MAX_DISTANCE_KM } from '../adapters/nws/nws.ts';
import type {
  CurrentWeather,
  FlowForecastSource,
  FlowSource,
  WeatherSource,
} from '../adapters/types.ts';
import { createUsgsAdapter } from '../adapters/usgs/usgs.ts';
import { getConditions } from '../services/conditions.ts';
import type { SourceCache } from '../services/sourceCache.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Replayed forecasts are dated this long before the replay time, about how often NWS updates
// its grids. A station report newer than that replaces the forecast in the current hour, as in
// the app.
export const REPLAY_FORECAST_AGE_MS = HOUR;

export const CaseFile = z.object({
  name: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lat: z.number(),
  lon: z.number(),
  gauges: z.array(z.string().regex(/^USGS-\d+$/)).min(1),
  station: z.string().optional(),
  window: z.object({ start: z.string(), endExclusive: z.string() }),
});
export type CaseFile = z.infer<typeof CaseFile>;

export interface RecordedCase {
  meta: CaseFile;
  byName: Map<string, unknown>; // file name without .json -> recorded body
  byUrl: Map<string, unknown>; // recorded URL -> recorded body
}

const Fixture = z.object({ url: z.string(), body: z.unknown() });

export async function loadCase(dir: string): Promise<RecordedCase> {
  const meta = CaseFile.parse(JSON.parse(await readFile(join(dir, 'case.json'), 'utf8')));
  const byName = new Map<string, unknown>();
  const byUrl = new Map<string, unknown>();
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
    if (file === 'case.json') continue;
    const fixture = Fixture.parse(JSON.parse(await readFile(join(dir, file), 'utf8')));
    byName.set(file.slice(0, -'.json'.length), fixture.body);
    byUrl.set(fixture.url, fixture.body);
  }
  return { meta, byName, byUrl };
}

export interface ReplayInput {
  recorded: RecordedCase;
  at: string; // ISO 8601 UTC: the moment the app is replayed at
  timeZone: string; // IANA, as NWS would have given for the location
  ruleSet: RuleSet;
  boatClassId?: string; // default: the rule set's first boat class
}

export interface ObservedHour {
  time: string;
  // 'station': a routine report in this hour. 'modeled': Open-Meteo history. Absent: neither.
  basis?: 'station' | 'modeled';
  values: WeatherValues;
}

export interface Replay {
  at: string;
  ruleSet: RuleSet;
  boatClassId: string;
  conditions: ConditionsResponse;
  // The forecast as the rule set sees it: flow from its named gauge, if it names one.
  forecast: ForecastPoint[];
  timeline: TimelineResult;
  observed: ObservedHour[]; // one per forecast hour: what happened
  measured: MeasuredTimeline;
  forecastLeads: (ForecastLead | null)[]; // one per forecast hour: how far ahead it was made
  warnings: string[]; // adapter warnings and sources that failed
}

// What the rule set would have said with the values measured in each hour, to compare with what
// the app showed. Weather comes from the station report filed in the hour (never modeled history),
// and river values from the gauge's last reading in the hour. Chance of rain has no measurement,
// so its limits are left out rather than making every hour unknown.
export interface MeasuredTimeline {
  points: ForecastPoint[]; // one per forecast hour
  hours: HourResult[]; // empty when the rule set has nothing measurable to compare
  leftOut: Metric[]; // metrics whose limits were left out
}

const UNMEASURED: readonly Metric[] = ['precipChance'];

// The earliest and latest replay times whose 48 hours ahead the case covers.
export function replayRange(meta: CaseFile): { earliest: string; latest: string } {
  const start = Date.parse(`${meta.window.start}T00:00:00Z`);
  const end = Date.parse(`${meta.window.endExclusive}T00:00:00Z`);
  return { earliest: new Date(start).toISOString(), latest: new Date(end - 2 * DAY).toISOString() };
}

// Throws when `at` is outside replayRange or the case is missing a fixture it needs.
export async function replayCase(input: ReplayInput): Promise<Replay> {
  const { recorded, ruleSet } = input;
  const { meta } = recorded;
  const now = new Date(input.at);
  const nowMs = now.getTime();
  const range = replayRange(meta);
  if (
    !Number.isFinite(nowMs) ||
    nowMs < Date.parse(range.earliest) ||
    nowMs > Date.parse(range.latest)
  ) {
    throw new Error(
      `Replay time ${input.at} is outside the case's range, ${range.earliest} to ${range.latest}`,
    );
  }
  const boatClassId = input.boatClassId ?? ruleSet.boatClasses[0]?.id;
  if (!boatClassId || !ruleSet.boatClasses.some((c) => c.id === boatClassId)) {
    throw new Error(`Rule set ${ruleSet.name} has no boat class ${input.boatClassId}`);
  }

  const warnings: string[] = [];
  const logger: Logger = {
    warn: (message, details) =>
      warnings.push(details ? `${message} ${JSON.stringify(details)}` : message),
  };

  const runsBody = recorded.byName.get('open-meteo-previous-runs');
  if (runsBody === undefined) throw new Error('The case has no open-meteo-previous-runs fixture');
  const runs = parsePreviousRuns(runsBody);
  const stationFile = [...recorded.byName.keys()].find((n) => n.startsWith('iem-asos-'));
  const reports = stationFile ? parseAsos(recorded.byName.get(stationFile)) : [];
  const archiveBody = recorded.byName.get('open-meteo-archive');
  const modeled = archiveBody === undefined ? undefined : parseModeledHistory(archiveBody);

  const sources = replaySources({ recorded, now, logger, timeZone: input.timeZone, runs, reports });
  const flowGaugeRefs: GaugeRef[] = ruleSet.flowGaugeRef ? [ruleSet.flowGaugeRef] : [];
  const conditions = await getConditions(
    {
      lat: meta.lat,
      lon: meta.lon,
      gaugeRef: `usgs:${meta.gauges[0]}`,
      flowGaugeRefs,
    },
    { ...sources, cache: passThroughCache(now), now: () => now },
  );
  for (const source of conditions.sources) {
    if (source.status !== 'ok') warnings.push(`${source.id}: ${source.message ?? source.status}`);
  }

  // As the web app evaluates a location (evaluateLocation).
  const timelineInput = {
    forecast: conditions.forecast,
    ruleSet,
    boatClassId,
    lat: meta.lat,
    lon: meta.lon,
    now: now.toISOString(),
    flowByGauge: Object.fromEntries(conditions.flowSeries.map((s) => [s.gaugeRef, s.points])),
  };
  const timeline = evaluateTimeline(timelineInput);

  const modeledByTime = new Map(modeled?.hours.map((h) => [Date.parse(h.time), h.values]));
  const observed = conditions.forecast.map((point): ObservedHour => {
    const hourMs = Date.parse(point.time);
    const report = reports.find((r) => {
      const t = Date.parse(r.time);
      return t >= hourMs && t < hourMs + HOUR;
    });
    if (report) return { time: point.time, basis: 'station', values: report.values };
    const values = modeledByTime.get(hourMs);
    if (values) return { time: point.time, basis: 'modeled', values };
    return { time: point.time, values: {} };
  });

  const measured = await measuredTimeline({
    recorded,
    logger,
    times: conditions.forecast.map((p) => p.time),
    reports,
    ruleSet,
    boatClassId,
  });

  return {
    at: now.toISOString(),
    ruleSet,
    boatClassId,
    conditions,
    forecast: forecastForRuleSet(timelineInput),
    timeline,
    observed,
    measured,
    forecastLeads: conditions.forecast.map((p) => forecastLead(Date.parse(p.time), nowMs)),
    warnings,
  };
}

interface MeasuredInput {
  recorded: RecordedCase;
  logger: Logger;
  times: string[];
  reports: AsosReport[];
  ruleSet: RuleSet;
  boatClassId: string;
}

async function measuredTimeline(input: MeasuredInput): Promise<MeasuredTimeline> {
  const { recorded, times, reports, ruleSet, boatClassId } = input;
  const { meta } = recorded;
  const usgsAdapter = createUsgsAdapter({
    fetch: fixtureFetch(recorded.byUrl),
    logger: input.logger,
  });
  const from = `${meta.window.start}T00:00:00Z`;
  const to = `${meta.window.endExclusive}T00:00:00Z`;
  const readings = async (gaugeId: string, metric: Metric) => {
    const result = await usgsAdapter.getHistory(gaugeId, metric, from, to);
    return result.ok ? result.data : [];
  };

  // As in the app: flow from the gauge the rule set names, if it names one; everything else
  // from the location's gauge.
  const displayGauge = meta.gauges[0] as string;
  const flowRef = ruleSet.flowGaugeRef;
  const flowGauge = flowRef === undefined ? displayGauge : flowRef.replace(/^usgs:/, '');
  const river: Reading[] = [
    ...(flowRef === undefined || flowRef.startsWith('usgs:')
      ? await readings(flowGauge, 'flow')
      : []),
    ...(await readings(displayGauge, 'gaugeHeight')),
    ...(await readings(displayGauge, 'waterTemp')),
  ];

  const points = times.map((time): ForecastPoint => {
    const start = Date.parse(time);
    const inHour = (t: string) => Date.parse(t) >= start && Date.parse(t) < start + HOUR;
    const point: ForecastPoint = { time, values: {}, provenance: {} };
    for (const r of river.filter((x) => inHour(x.observedAt))) {
      const seen = point.provenance[r.metric];
      if (seen && seen.asOf >= r.observedAt) continue;
      point.values[r.metric] = r.value;
      point.provenance[r.metric] = {
        kind: 'observation',
        asOf: r.observedAt,
        source: 'usgs',
        ...(r.sourceRef ? { sourceRef: r.sourceRef } : {}),
        ...(r.qualifiers ? { qualifiers: r.qualifiers } : {}),
      };
    }
    const report = reports.filter((r) => inHour(r.time)).at(-1);
    if (report) {
      for (const [metric, value] of Object.entries(report.values) as [Metric, number | null][]) {
        point.values[metric] = value;
        point.provenance[metric] = {
          kind: 'observation',
          asOf: report.time,
          source: 'nws',
          sourceRef: meta.station ?? report.station,
        };
      }
    }
    return point;
  });

  const measurable = {
    ...ruleSet,
    thresholds: ruleSet.thresholds.filter((t) => !UNMEASURED.includes(t.metric)),
  };
  const leftOut = [
    ...new Set(
      ruleSet.thresholds
        .filter(
          (t) =>
            UNMEASURED.includes(t.metric) &&
            (t.boatClassIds === undefined || t.boatClassIds.includes(boatClassId)),
        )
        .map((t) => t.metric),
    ),
  ];
  // Evaluated one hour at a time, each as of the end of its hour, so a reading taken in the hour
  // is never too old. A metric no hour has a measurement for has no source, as in the app.
  const timeline = evaluateTimeline({
    forecast: points,
    ruleSet: measurable,
    boatClassId,
    lat: meta.lat,
    lon: meta.lon,
    now: times[0] ?? new Date(0).toISOString(),
    // The points already carry flow from the rule set's gauge. Without this, evaluation would
    // drop it and treat flow as having no source.
    ...(flowRef ? { flowByGauge: { [flowRef]: points } } : {}),
  });
  const hours = timeline.hasLimits
    ? points.map((point) =>
        evaluateHour(point, {
          ruleSet: measurable,
          boatClassId,
          lat: meta.lat,
          lon: meta.lon,
          now: new Date(Date.parse(point.time) + HOUR).toISOString(),
          unavailableMetrics: timeline.unavailableMetrics,
        }),
      )
    : [];
  return { points, hours, leftOut };
}

// The forecast the app could have had at `nowMs` for an hour: one made a day before the hour if
// that was already made, otherwise one made two days before. Never one made after `nowMs`.
export function forecastLead(hourMs: number, nowMs: number): ForecastLead | null {
  if (hourMs - DAY <= nowMs) return 1;
  if (hourMs - 2 * DAY <= nowMs) return 2;
  return null;
}

function passThroughCache(now: Date): SourceCache {
  return {
    async get(_key, _ttlMs, _schema, fetch) {
      const result = await fetch();
      return result.ok
        ? { status: 'ok', data: result.data, fetchedAt: now.toISOString(), cached: false }
        : { status: 'error', error: result.error };
    },
  };
}

// Serves the case's recorded bodies by exact URL. Anything else wasn't recorded and fails.
function fixtureFetch(byUrl: Map<string, unknown>): FetchFn {
  return async (url) => {
    if (!byUrl.has(url)) throw new Error(`Not recorded in this case: ${url}`);
    return new Response(JSON.stringify(byUrl.get(url)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

const usgsMetrics: Metric[] = ['flow', 'gaugeHeight', 'waterTemp'];

interface SourceInput {
  recorded: RecordedCase;
  now: Date;
  logger: Logger;
  timeZone: string;
  runs: ReturnType<typeof parsePreviousRuns>;
  reports: AsosReport[];
}

function replaySources(input: SourceInput): {
  usgs: FlowSource;
  nwps: FlowForecastSource;
  nws: WeatherSource;
} {
  const { recorded, now, logger, runs, reports } = input;
  const { meta } = recorded;
  const nowMs = now.getTime();
  const fetchedAt = now.toISOString();
  const from = `${meta.window.start}T00:00:00Z`;
  const to = `${meta.window.endExclusive}T00:00:00Z`;
  const usgsAdapter = createUsgsAdapter({
    fetch: fixtureFetch(recorded.byUrl),
    logger,
    now: () => now,
  });

  const usgs: FlowSource = {
    id: 'usgs',
    findNearby: async () => ({ ok: true, data: [] }),
    // Gauge names aren't recorded; the ID stands in for display.
    getGauge: async (gaugeId) => {
      if (!meta.gauges.includes(gaugeId)) return { ok: true, data: null };
      const gauge: Gauge = {
        ref: `usgs:${gaugeId}`,
        source: 'usgs',
        name: gaugeId,
        lat: meta.lat,
        lon: meta.lon,
        metrics: [],
      };
      return { ok: true, data: gauge };
    },
    // The latest reading of each metric at or before the replay time, as the latest-continuous
    // collection would have returned then.
    getLatest: async (gaugeId) => {
      const latest = new Map<Metric, Reading>();
      for (const metric of usgsMetrics) {
        const result = await usgsAdapter.getHistory(gaugeId, metric, from, to);
        if (!result.ok) return result;
        for (const r of result.data) {
          if (Date.parse(r.observedAt) > nowMs) continue;
          const seen = latest.get(r.metric);
          if (!seen || r.observedAt > seen.observedAt) latest.set(r.metric, r);
        }
      }
      return { ok: true, data: [...latest.values()] };
    },
    getHistory: (gaugeId, metric, f, t) => usgsAdapter.getHistory(gaugeId, metric, f, t),
  };

  // NWPS keeps no past forecasts (#81), so a replay has none.
  const nwps: FlowForecastSource = {
    id: 'nwps',
    findNearby: async () => ({ ok: true, data: [] }),
    getGauge: async () => ({ ok: true, data: null }),
    getStageFlow: async () => ({
      ok: false,
      error: { source: 'nwps', kind: 'unavailable', message: 'No past forecasts' },
    }),
  };

  const asOf = new Date(nowMs - REPLAY_FORECAST_AGE_MS).toISOString();
  const leadHours = new Map(
    ([1, 2] as const).map((lead) => [
      lead,
      new Map(runs.byLead[lead].map((h) => [Date.parse(h.time), h.values])),
    ]),
  );
  function forecast(hours: number): ForecastPoint[] {
    const start = Math.floor(nowMs / HOUR) * HOUR;
    const points: ForecastPoint[] = [];
    for (let i = 0; i < hours; i += 1) {
      const ms = start + i * HOUR;
      const lead = forecastLead(ms, nowMs);
      const values = lead === null ? undefined : leadHours.get(lead)?.get(ms);
      if (lead === null || values === undefined) continue;
      const provenance = Object.fromEntries(
        Object.keys(values).map((metric) => [
          metric,
          {
            kind: 'forecast' as const,
            asOf,
            source: 'nws' as const,
            sourceRef: `open-meteo:${FORECAST_MODEL}:day${lead}`,
          },
        ]),
      );
      points.push({ time: new Date(ms).toISOString(), values, provenance });
    }
    return points;
  }

  const nws: WeatherSource = {
    id: 'nws',
    getPoint: async () => ({
      ok: true,
      data: { gridId: 'replay', gridX: 0, gridY: 0, timeZone: input.timeZone },
    }),
    getHourlyForecast: async (_lat, _lon, hours) => ({ ok: true, data: forecast(hours) }),
    // The app's rule: the station's latest report if it's within 30 km and 2 hours old,
    // otherwise the forecast's current hour, labeled as forecast.
    getCurrent: async (): Promise<SourceResult<CurrentWeather>> => {
      const report = reports.filter((r) => Date.parse(r.time) <= nowMs).at(-1);
      const stationId = meta.station ?? report?.station ?? '';
      if (report) {
        const km = distanceKm(meta.lat, meta.lon, report.lat, report.lon);
        const age = nowMs - Date.parse(report.time);
        if (km <= STATION_MAX_DISTANCE_KM && age <= STATION_MAX_AGE_HOURS * HOUR) {
          const readings: Reading[] = Object.entries(report.values).map(([metric, value]) => ({
            metric: metric as Metric,
            value,
            observedAt: report.time,
            fetchedAt,
            source: 'nws',
            sourceRef: stationId,
          }));
          return {
            ok: true,
            data: {
              basis: 'station',
              station: { id: stationId, name: stationId, distanceKm: km },
              readings,
            },
          };
        }
      }
      const hour = forecast(1)[0];
      const readings: Reading[] = Object.entries(hour?.values ?? {}).map(([metric, value]) => ({
        metric: metric as Metric,
        value,
        observedAt: hour?.time ?? fetchedAt,
        fetchedAt,
        source: 'nws',
        sourceRef: `open-meteo:${FORECAST_MODEL}`,
      }));
      return { ok: true, data: { basis: 'forecast', readings } };
    },
    // Alerts aren't recorded.
    getAlerts: async () => ({ ok: true, data: [] }),
  };

  return { usgs, nwps, nws };
}
