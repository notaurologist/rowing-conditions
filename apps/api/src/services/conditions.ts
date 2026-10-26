import {
  Alert,
  DaylightTimes,
  daylightTimes,
  ForecastPoint,
  Gauge,
  type GaugeRef,
  Reading,
  type SourceId,
  UtcTime,
} from '@rowing/core';
import { z } from 'zod';
import type { FlowForecastSource, FlowSource, WeatherSource } from '../adapters/types.ts';
import { withLatestMeasurements } from './latestMeasurements.ts';
import { riverHours } from './riverHours.ts';
import { type CachedResult, cacheTtlMs, type SourceCache } from './sourceCache.ts';

export const FORECAST_HOURS = 48;
// Cached longer than shown, so a cached forecast still covers the next 48 hours as time passes.
const FORECAST_HOURS_FETCHED = 72;
const HOUR = 3_600_000;

// Schemas for cached payloads: stored JSON is re-validated on read.
const Readings = z.array(Reading);
const ForecastPoints = z.array(ForecastPoint);
const StageFlowPayload = z.object({
  observed: Readings,
  forecast: ForecastPoints,
  issuedAt: UtcTime.nullable(),
});
const WeatherPointPayload = z.object({
  gridId: z.string(),
  gridX: z.number(),
  gridY: z.number(),
  timeZone: z.string(),
  place: z.string().optional(),
});
const CurrentWeatherPayload = z.object({
  basis: z.enum(['station', 'forecast']),
  station: z.object({ id: z.string(), name: z.string(), distanceKm: z.number() }).optional(),
  readings: Readings,
});

export const SourceStatus = z.object({
  id: z.enum(['usgs', 'nwps', 'nws']),
  status: z.enum(['ok', 'stale', 'error']),
  fetchedAt: UtcTime.optional(), // the oldest data from this source in the response
  message: z.string().optional(),
});
export type SourceStatus = z.infer<typeof SourceStatus>;

export const ConditionsResponse = z.object({
  location: z.object({
    lat: z.number(),
    lon: z.number(),
    timezone: z.string().nullable(), // IANA, from NWS; null if unavailable
    place: z.string().optional(),
  }),
  gauge: Gauge.pick({ ref: true, name: true, lat: true, lon: true }).optional(),
  current: Readings,
  currentBasis: z.enum(['station', 'forecast']).optional(),
  station: z.object({ id: z.string(), name: z.string(), distanceKm: z.number() }).optional(),
  forecast: ForecastPoints, // FORECAST_HOURS hourly points from the current hour
  flowSeries: z.array(z.object({ gaugeRef: z.string(), points: ForecastPoints })),
  daylight: z.array(DaylightTimes),
  alerts: z.array(Alert),
  sources: z.array(SourceStatus),
});
export type ConditionsResponse = z.infer<typeof ConditionsResponse>;

export interface ConditionsDeps {
  usgs: FlowSource;
  nwps: FlowForecastSource;
  nws: WeatherSource;
  cache: SourceCache;
  now: () => Date;
}

export interface ConditionsInput {
  lat: number;
  lon: number;
  gaugeRef?: GaugeRef; // the location's display gauge
  flowGaugeRefs?: GaugeRef[]; // gauges named by rule sets for their flow limits
}

interface River {
  gauge: Gauge | null;
  latest: Reading[];
  forecast: ForecastPoint[];
}

function splitRef(ref: GaugeRef): { source: 'usgs' | 'nwps'; id: string } {
  const at = ref.indexOf(':');
  return { source: ref.slice(0, at) as 'usgs' | 'nwps', id: ref.slice(at + 1) };
}

// Local solar dates covering the window, so daylight needs no time zone.
function solarDates(times: readonly string[], lon: number): string[] {
  const dates = times.map((t) =>
    new Date(Date.parse(t) + (lon / 15) * HOUR).toISOString().slice(0, 10),
  );
  return [...new Set(dates)].sort();
}

export async function getConditions(
  input: ConditionsInput,
  deps: ConditionsDeps,
): Promise<ConditionsResponse> {
  const { lat, lon } = input;
  const { cache, usgs, nwps, nws } = deps;
  const point = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const results: { source: SourceId; result: CachedResult<unknown> }[] = [];
  const track = async <T>(source: SourceId, pending: Promise<CachedResult<T>>) => {
    const result = await pending;
    results.push({ source, result });
    return result.status === 'error' ? undefined : result.data;
  };

  async function river(ref: GaugeRef): Promise<River> {
    const { source, id } = splitRef(ref);
    const stageFlow = (lid: string) =>
      track(
        'nwps',
        cache.get(`nwps:stageflow:${lid}`, cacheTtlMs.nwpsStageFlow, StageFlowPayload, () =>
          nwps.getStageFlow(lid),
        ),
      );
    const nwpsGauge = (identifier: string) =>
      track(
        'nwps',
        cache.get(`nwps:gauge:${identifier}`, cacheTtlMs.gaugeMetadata, Gauge.nullable(), () =>
          nwps.getGauge(identifier),
        ),
      );

    if (source === 'nwps') {
      const [gauge, flow] = await Promise.all([nwpsGauge(id), stageFlow(id)]);
      return { gauge: gauge ?? null, latest: flow?.observed ?? [], forecast: flow?.forecast ?? [] };
    }

    const usgsNumber = id.replace(/^USGS-/, '');
    const [gauge, latest, forecastPoint] = await Promise.all([
      track(
        'usgs',
        cache.get(`usgs:gauge:${id}`, cacheTtlMs.gaugeMetadata, Gauge.nullable(), () =>
          usgs.getGauge(id),
        ),
      ),
      track(
        'usgs',
        cache.get(`usgs:latest:${id}`, cacheTtlMs.usgsLatest, Readings, () => usgs.getLatest(id)),
      ),
      nwpsGauge(usgsNumber),
    ]);
    const lid = forecastPoint?.hasFlowForecast ? splitRef(forecastPoint.ref).id : undefined;
    const flow = lid ? await stageFlow(lid) : undefined;
    return { gauge: gauge ?? null, latest: latest ?? [], forecast: flow?.forecast ?? [] };
  }

  const [weatherPoint, weather, current, alerts, display, ...named] = await Promise.all([
    track(
      'nws',
      cache.get(`nws:point:${point}`, cacheTtlMs.nwsPoint, WeatherPointPayload, () =>
        nws.getPoint(lat, lon),
      ),
    ),
    track(
      'nws',
      cache.get(`nws:forecast:${point}`, cacheTtlMs.nwsForecast, ForecastPoints, () =>
        nws.getHourlyForecast(lat, lon, FORECAST_HOURS_FETCHED),
      ),
    ),
    track(
      'nws',
      cache.get(`nws:current:${point}`, cacheTtlMs.nwsCurrent, CurrentWeatherPayload, () =>
        nws.getCurrent(lat, lon),
      ),
    ),
    track(
      'nws',
      cache.get(`nws:alerts:${point}`, cacheTtlMs.nwsAlerts, z.array(Alert), () =>
        nws.getAlerts(lat, lon),
      ),
    ),
    input.gaugeRef ? river(input.gaugeRef) : Promise.resolve(undefined),
    ...(input.flowGaugeRefs ?? []).map(river),
  ]);

  const start = Math.floor(deps.now().getTime() / HOUR) * HOUR;
  const times = Array.from({ length: FORECAST_HOURS }, (_, i) =>
    new Date(start + i * HOUR).toISOString(),
  );
  const weatherByTime = new Map((weather ?? []).map((p) => [Date.parse(p.time), p]));
  const displayHours = riverHours(times, display?.forecast ?? [], display?.latest ?? []);
  // Station readings are measurements; forecast-based current weather is not.
  const measured = [
    ...(current?.basis === 'station' ? current.readings : []),
    ...(display?.latest ?? []),
  ];
  const forecast: ForecastPoint[] = times.map((time, i) => {
    const w = weatherByTime.get(Date.parse(time));
    const r = displayHours[i];
    const point = {
      time,
      values: { ...w?.values, ...r?.values },
      provenance: { ...w?.provenance, ...r?.provenance },
    };
    return i === 0 ? withLatestMeasurements(point, measured) : point;
  });

  const flowSeries = (input.flowGaugeRefs ?? []).map((gaugeRef, i) => {
    const data = named[i];
    const hours = riverHours(times, data?.forecast ?? [], data?.latest ?? []);
    return {
      gaugeRef,
      points: times.map((time, h) => {
        const hour = hours[h];
        const flow = hour?.provenance.flow;
        const point: ForecastPoint = flow
          ? { time, values: { flow: hour?.values.flow ?? null }, provenance: { flow } }
          : { time, values: {}, provenance: {} };
        const flowReadings = (data?.latest ?? []).filter((reading) => reading.metric === 'flow');
        return h === 0 ? withLatestMeasurements(point, flowReadings) : point;
      }),
    };
  });

  const latestDisplay = display
    ? riverHours([times[0] as string], [], display.latest)[0]
    : undefined;
  const gaugeReadings = (display?.latest ?? []).filter(
    (r) => latestDisplay?.provenance[r.metric]?.asOf === r.observedAt,
  );

  return {
    location: {
      lat,
      lon,
      timezone: weatherPoint?.timeZone ?? null,
      ...(weatherPoint?.place ? { place: weatherPoint.place } : {}),
    },
    ...(display?.gauge
      ? {
          gauge: {
            ref: display.gauge.ref,
            name: display.gauge.name,
            lat: display.gauge.lat,
            lon: display.gauge.lon,
          },
        }
      : {}),
    current: [...(current?.readings ?? []), ...gaugeReadings],
    ...(current ? { currentBasis: current.basis } : {}),
    ...(current?.station ? { station: current.station } : {}),
    forecast,
    flowSeries,
    daylight: solarDates(times, lon).map((date) => daylightTimes(date, lat, lon)),
    alerts: alerts ?? [],
    sources: summarize(results),
  };
}

// One status per source: an error anywhere wins, then stale, then ok.
function summarize(results: { source: SourceId; result: CachedResult<unknown> }[]): SourceStatus[] {
  const order: SourceStatus['id'][] = ['usgs', 'nwps', 'nws'];
  return order.flatMap((id) => {
    const mine = results.filter((r) => r.source === id).map((r) => r.result);
    if (mine.length === 0) return [];
    const failed = mine.find((r) => r.status === 'error');
    const stale = mine.find((r) => r.status === 'stale');
    const status = failed ? 'error' : stale ? 'stale' : 'ok';
    const times = mine.flatMap((r) => (r.status === 'error' ? [] : [r.fetchedAt])).sort();
    const problem = failed ?? stale;
    return [
      {
        id,
        status,
        ...(times[0] ? { fetchedAt: times[0] } : {}),
        ...(problem ? { message: problem.error.message } : {}),
      },
    ];
  });
}
