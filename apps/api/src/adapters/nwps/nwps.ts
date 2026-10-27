import {
  boundingBox,
  distanceKm,
  type ForecastPoint,
  type Gauge,
  interpolateHourly,
  type NearbyGauge,
  Reading,
  toSI,
  type Unit,
} from '@rowing/core';
import {
  consoleLogger,
  type FetchFn,
  fetchJson,
  type Logger,
  type RequestOptions,
} from '../http.ts';
import type { FlowForecastSource, StageFlow } from '../types.ts';
import { gaugeUrl, nearbyGaugesUrl, stageFlowUrl } from './requests.ts';
import { NwpsGauge, NwpsGaugeList, type NwpsSeries, NwpsStageFlow } from './schemas.ts';

export interface NwpsAdapterOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  logger?: Logger;
  now?: () => Date;
}

const unitByName: Record<string, Unit> = { ft: 'ft', m: 'm', kcfs: 'kcfs', cfs: 'cfs' };

// NWPS marks missing values with -999 (observations) and -9999 (unset thresholds).
const isSentinel = (value: number) => value <= -999;

// A forecast object is returned even for gauges without one, with this issue time and no data.
const hasForecast = (s: NwpsSeries) => s.data.length > 0 && !s.issuedTime.startsWith('0001-');

function toGauge(g: NwpsGauge): Gauge {
  return {
    ref: `nwps:${g.lid}`,
    source: 'nwps',
    name: g.name,
    lat: g.latitude,
    lon: g.longitude,
    metrics: g.pedts.observed ? ['flow', 'gaugeHeight'] : [],
    hasFlowForecast: g.pedts.forecast !== '',
    ...(g.usgsId ? { linkedRef: `usgs:USGS-${g.usgsId}` as const } : {}),
  };
}

export function createNwpsAdapter(options: NwpsAdapterOptions = {}): FlowForecastSource {
  const logger = options.logger ?? consoleLogger;
  const now = options.now ?? (() => new Date());
  const request: RequestOptions = {
    source: 'nwps',
    fetch: options.fetch ?? globalThis.fetch,
    logger,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };

  // Converts a series' value to SI, or null for sentinels. undefined when the unit is unknown.
  function converter(series: NwpsSeries, which: 'primary' | 'secondary', lid: string) {
    const name = which === 'primary' ? series.primaryUnits : series.secondaryUnits;
    const unit = unitByName[name];
    if (unit === undefined) {
      logger.warn('nwps: unknown unit, series skipped', { gauge: lid, series: which, unit: name });
      return undefined;
    }
    return (value: number) => (isSentinel(value) ? null : toSI(value, unit));
  }

  function observedReadings(series: NwpsSeries, lid: string, fetchedAt: string): Reading[] {
    const readings: Reading[] = [];
    const fields = [
      ['flow', converter(series, 'secondary', lid)],
      ['gaugeHeight', converter(series, 'primary', lid)],
    ] as const;
    for (const point of series.data) {
      for (const [metric, convert] of fields) {
        if (convert === undefined) continue;
        const value = convert(metric === 'flow' ? point.secondary : point.primary);
        const reading = {
          metric,
          value,
          observedAt: new Date(point.validTime).toISOString(),
          fetchedAt,
          source: 'nwps' as const,
          sourceRef: lid,
          // Negative flow is the river running backward (#116): shown, never compared.
          ...(metric === 'flow' && value !== null && value < 0
            ? { qualifiers: ['reversedFlow' as const] }
            : {}),
        };
        if (Reading.safeParse(reading).success) {
          readings.push(reading);
        } else {
          logger.warn('nwps: reading out of range, treated as missing', { gauge: lid, metric });
          readings.push({ ...reading, value: null });
        }
      }
    }
    return readings.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  }

  function hourlyForecast(series: NwpsSeries, lid: string): ForecastPoint[] {
    const asOf = new Date(series.issuedTime).toISOString();
    const flow = converter(series, 'secondary', lid);
    const height = converter(series, 'primary', lid);
    const step = (
      convert: ((v: number) => number | null) | undefined,
      field: 'primary' | 'secondary',
    ) =>
      convert === undefined
        ? []
        : interpolateHourly(
            series.data.map((p) => ({ time: p.validTime, value: convert(p[field]) })),
          );
    const flowByTime = new Map(step(flow, 'secondary').map((h) => [h.time, h]));
    const heightByTime = new Map(step(height, 'primary').map((h) => [h.time, h]));

    const times = [...new Set([...flowByTime.keys(), ...heightByTime.keys()])].sort();
    return times.map((time) => {
      const point: ForecastPoint = { time, values: {}, provenance: {} };
      for (const [metric, byTime] of [
        ['flow', flowByTime],
        ['gaugeHeight', heightByTime],
      ] as const) {
        const hour = byTime.get(time);
        if (hour === undefined) continue;
        point.values[metric] = hour.value;
        point.provenance[metric] = {
          kind: 'forecast',
          asOf,
          source: 'nwps',
          sourceRef: lid,
          ...(hour.interpolated ? { interpolated: true } : {}),
        };
      }
      return point;
    });
  }

  return {
    id: 'nwps',

    async findNearby(lat, lon, radiusKm) {
      const result = await fetchJson(
        nearbyGaugesUrl(boundingBox(lat, lon, radiusKm)),
        NwpsGaugeList,
        request,
      );
      if (!result.ok) return result;
      const data: NearbyGauge[] = result.data.gauges
        .filter((g) => g.inService?.enabled !== false)
        .map((g) => ({ ...toGauge(g), distanceKm: distanceKm(lat, lon, g.latitude, g.longitude) }))
        .filter((g) => g.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm);
      return { ok: true, data };
    },

    async getGauge(identifier) {
      const result = await fetchJson(gaugeUrl(identifier), NwpsGauge, request);
      if (!result.ok) {
        return result.error.kind === 'http' && result.error.status === 404
          ? { ok: true, data: null }
          : result;
      }
      return { ok: true, data: toGauge(result.data) };
    },

    async getStageFlow(lid) {
      const result = await fetchJson(stageFlowUrl(lid), NwpsStageFlow, request);
      if (!result.ok) return result;
      const { observed, forecast } = result.data;
      const fetchedAt = now().toISOString();
      const stageFlow: StageFlow = hasForecast(forecast)
        ? {
            observed: observedReadings(observed, lid, fetchedAt),
            forecast: hourlyForecast(forecast, lid),
            issuedAt: new Date(forecast.issuedTime).toISOString(),
          }
        : { observed: observedReadings(observed, lid, fetchedAt), forecast: [], issuedAt: null };
      return { ok: true, data: stageFlow };
    },
  };
}
