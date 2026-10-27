import {
  boundingBox,
  distanceKm,
  type Gauge,
  type Metric,
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
  type SourceResult,
} from '../http.ts';
import type { FlowSource } from '../types.ts';
import { mapUsgsQualifiers } from './qualifiers.ts';
import {
  historyUrl,
  INSTANTANEOUS,
  latestReadingsUrl,
  locationUrl,
  nearbyLocationsUrl,
  timeSeriesMetadataUrl,
  usgsParameterCodes,
} from './requests.ts';
import { UsgsLocation, UsgsLocations, UsgsReadings, UsgsSeriesMetadata } from './schemas.ts';

export interface UsgsAdapterOptions {
  fetch?: FetchFn;
  apiKey?: string; // USGS_API_KEY; omitted entirely when unset, since an invalid key gets 403
  timeoutMs?: number;
  logger?: Logger;
  now?: () => Date;
}

const metricByCode: Record<string, Metric> = Object.fromEntries(
  Object.entries(usgsParameterCodes).map(([metric, code]) => [code, metric as Metric]),
);

// USGS unit_of_measure strings, as returned by the API.
const unitByName: Record<string, Unit> = {
  'ft^3/s': 'cfs',
  'm^3/s': 'm3/s',
  ft: 'ft',
  m: 'm',
  degC: 'degC',
  degF: 'degF',
};

const METADATA_BATCH = 100; // keeps the comma-separated id list a reasonable URL length

export function createUsgsAdapter(options: UsgsAdapterOptions = {}): FlowSource {
  const logger = options.logger ?? consoleLogger;
  const now = options.now ?? (() => new Date());
  const request: RequestOptions = {
    source: 'usgs',
    fetch: options.fetch ?? globalThis.fetch,
    logger,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.apiKey ? { headers: { 'X-Api-Key': options.apiKey } } : {}),
  };

  function warnIfTruncated(links: { rel: string }[] | undefined, what: string) {
    if (links?.some((link) => link.rel === 'next')) {
      logger.warn(`usgs: ${what} has more results than one page; only the first page is used`);
    }
  }

  function toReading(
    p: UsgsReadings['features'][number]['properties'],
    fetchedAt: string,
  ): Reading | null {
    const metric = metricByCode[p.parameter_code];
    if (metric === undefined || p.statistic_id !== INSTANTANEOUS) return null;
    const unit = p.unit_of_measure === null ? undefined : unitByName[p.unit_of_measure];
    if (unit === undefined) {
      logger.warn('usgs: unknown unit, reading skipped', {
        gauge: p.monitoring_location_id,
        parameter: p.parameter_code,
        unit: p.unit_of_measure,
      });
      return null;
    }

    const mapped = mapUsgsQualifiers(p.approval_status, p.qualifier);
    if (mapped.unrecognized.length > 0) {
      logger.warn('usgs: unrecognized qualifier codes treated as unreliable', {
        gauge: p.monitoring_location_id,
        codes: mapped.unrecognized,
      });
    }

    const native = p.value === null ? Number.NaN : Number(p.value);
    const value = Number.isFinite(native) ? toSI(native, unit) : null;
    // Negative discharge is the river running backward, as at Northfield below the pumped
    // storage station (#116): shown, and marked so it's never compared against a limit.
    const qualifiers =
      metric === 'flow' && value !== null && value < 0
        ? [...mapped.qualifiers, 'reversedFlow' as const]
        : mapped.qualifiers;
    const reading = {
      metric,
      value,
      observedAt: new Date(p.time).toISOString(),
      fetchedAt,
      source: 'usgs' as const,
      sourceRef: p.monitoring_location_id,
      ...(qualifiers.length > 0 ? { qualifiers } : {}),
    };
    const parsed = Reading.safeParse(reading);
    if (parsed.success) return parsed.data;
    // For example a negative gauge reading where none is possible: shown as missing, not dropped.
    logger.warn('usgs: reading out of range, treated as missing', {
      gauge: p.monitoring_location_id,
      parameter: p.parameter_code,
      issues: parsed.error.issues.map((i) => i.message),
    });
    return Reading.safeParse({ ...reading, value: null }).success
      ? { ...reading, value: null }
      : null;
  }

  async function readings(url: string): Promise<SourceResult<Reading[]>> {
    const result = await fetchJson(url, UsgsReadings, request);
    if (!result.ok) return result;
    warnIfTruncated(result.data.links, 'readings');
    const fetchedAt = now().toISOString();
    const data = result.data.features
      .map((f) => toReading(f.properties, fetchedAt))
      .filter((r): r is Reading => r !== null)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    return { ok: true, data };
  }

  // Which of our metrics each gauge reports in real time.
  async function metricsFor(ids: string[]): Promise<SourceResult<Map<string, Metric[]>>> {
    const metrics = new Map<string, Metric[]>(ids.map((id) => [id, []]));
    for (let i = 0; i < ids.length; i += METADATA_BATCH) {
      const result = await fetchJson(
        timeSeriesMetadataUrl(ids.slice(i, i + METADATA_BATCH)),
        UsgsSeriesMetadata,
        request,
      );
      if (!result.ok) return result;
      warnIfTruncated(result.data.links, 'time series metadata');
      for (const { properties: p } of result.data.features) {
        const metric = metricByCode[p.parameter_code];
        const list = metrics.get(p.monitoring_location_id);
        if (metric && list && p.statistic_id === INSTANTANEOUS && !list.includes(metric)) {
          list.push(metric);
        }
      }
    }
    return { ok: true, data: metrics };
  }

  function toGauge(
    location: {
      id: string;
      geometry: { coordinates: number[] };
      properties: { monitoring_location_name: string };
    },
    metrics: Metric[],
  ): Gauge {
    const [lon, lat] = location.geometry.coordinates as [number, number];
    return {
      ref: `usgs:${location.id}`,
      source: 'usgs',
      name: location.properties.monitoring_location_name,
      lat,
      lon,
      metrics,
    };
  }

  return {
    id: 'usgs',

    async findNearby(lat, lon, radiusKm) {
      const result = await fetchJson(
        nearbyLocationsUrl(boundingBox(lat, lon, radiusKm)),
        UsgsLocations,
        request,
      );
      if (!result.ok) return result;
      warnIfTruncated(result.data.links, 'nearby search');

      const nearby = result.data.features
        .map((location) => {
          const [gLon, gLat] = location.geometry.coordinates;
          return { location, distanceKm: distanceKm(lat, lon, gLat, gLon) };
        })
        .filter((g) => g.distanceKm <= radiusKm);
      if (nearby.length === 0) return { ok: true, data: [] };

      const metrics = await metricsFor(nearby.map((g) => g.location.id));
      if (!metrics.ok) return metrics;

      const data: NearbyGauge[] = nearby
        .map((g) => ({
          ...toGauge(g.location, metrics.data.get(g.location.id) ?? []),
          distanceKm: g.distanceKm,
        }))
        .filter((g) => g.metrics.length > 0) // gauges reporting none of flow, height, water temp
        .sort((a, b) => a.distanceKm - b.distanceKm);
      return { ok: true, data };
    },

    async getGauge(gaugeId) {
      const result = await fetchJson(locationUrl(gaugeId), UsgsLocation, request);
      if (!result.ok) {
        return result.error.kind === 'http' && result.error.status === 404
          ? { ok: true, data: null }
          : result;
      }
      const metrics = await metricsFor([gaugeId]);
      if (!metrics.ok) return metrics;
      return { ok: true, data: toGauge(result.data, metrics.data.get(gaugeId) ?? []) };
    },

    getLatest(gaugeId) {
      return readings(latestReadingsUrl([gaugeId]));
    },

    async getHistory(gaugeId, metric, from, to) {
      const code = usgsParameterCodes[metric as keyof typeof usgsParameterCodes];
      if (code === undefined) return { ok: true, data: [] }; // USGS doesn't report this metric
      return readings(historyUrl(gaugeId, code, from, to));
    },
  };
}
