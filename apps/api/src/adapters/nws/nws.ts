import {
  type Alert,
  distanceKm,
  ForecastPoint,
  isValueInRange,
  type Metric,
  type Qualifier,
  Reading,
  toSI,
} from '@rowing/core';
import type { z } from 'zod';
import {
  consoleLogger,
  type FetchFn,
  fetchJson,
  type Logger,
  type RequestOptions,
  type SourceResult,
} from '../http.ts';
import type { CurrentWeather, WeatherPoint, WeatherSource } from '../types.ts';
import { expandToHours, wmoUnit } from './intervals.ts';
import { alertsUrl, gridUrl, latestObservationUrl, pointsUrl, stationsUrl } from './requests.ts';
import {
  NwsAlerts,
  type NwsGrid,
  NwsGrid as NwsGridSchema,
  type NwsMeasurement,
  NwsObservation,
  NwsPoint,
  NwsStations,
} from './schemas.ts';

export interface NwsAdapterOptions {
  userAgent: string; // NWS_USER_AGENT; required, since requests without one get 403
  fetch?: FetchFn;
  timeoutMs?: number;
  retryDelayMs?: number;
  logger?: Logger;
  now?: () => Date;
}

const HOUR = 3_600_000;

// Current weather comes from a station only if it is this close and this fresh (#19).
export const STATION_MAX_DISTANCE_KM = 30;
export const STATION_MAX_AGE_HOURS = 2;
const STATIONS_TRIED = 3;

type WeatherMetric = Extract<
  Metric,
  'airTemp' | 'windSpeed' | 'windGust' | 'windDirection' | 'precipChance'
>;

const gridSeries: Record<WeatherMetric, keyof NwsGrid['properties']> = {
  airTemp: 'temperature',
  windSpeed: 'windSpeed',
  windGust: 'windGust',
  windDirection: 'windDirection',
  precipChance: 'probabilityOfPrecipitation',
};

const severities = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'] as const;

// NWS quality control: X rejected, Q questioned. Same treatment as unreliable USGS codes (#13).
const unreliableQualityCodes = new Set(['X', 'Q']);

const utc = (time: string) => new Date(time).toISOString();

export function createNwsAdapter(options: NwsAdapterOptions): WeatherSource {
  const logger = options.logger ?? consoleLogger;
  const now = options.now ?? (() => new Date());
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const request: RequestOptions = {
    source: 'nws',
    fetch: options.fetch ?? globalThis.fetch,
    logger,
    // Node's fetch sends Accept-Language: * by default, and the CDN kept a stale copy for it (#87).
    headers: {
      'User-Agent': options.userAgent,
      Accept: 'application/geo+json',
      'Accept-Language': 'en-US',
    },
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };

  // NWS returns intermittent 5xx errors: retry once after a pause.
  async function get<T>(url: string, schema: z.ZodType<T>): Promise<SourceResult<T>> {
    const first = await fetchJson(url, schema, request);
    if (first.ok || first.error.kind !== 'http' || (first.error.status ?? 0) < 500) return first;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    return fetchJson(url, schema, request);
  }

  // A value in SI (degrees for direction, a fraction for rain chance), or undefined if the unit
  // is unknown. Out-of-range values become null.
  function toInternal(
    metric: WeatherMetric,
    value: number | null,
    unitCode: string | null | undefined,
  ) {
    const unit = wmoUnit(unitCode);
    if (unit === undefined) return undefined;
    if (value === null) return null;
    const converted = unit === 'degrees' ? value % 360 : toSI(value, unit);
    return isValueInRange(metric, converted) ? converted : null;
  }

  async function point(lat: number, lon: number): Promise<SourceResult<WeatherPoint>> {
    const result = await get(pointsUrl(lat, lon), NwsPoint);
    if (!result.ok) return result;
    const p = result.data.properties;
    const place = p.relativeLocation?.properties;
    return {
      ok: true,
      data: {
        gridId: p.gridId,
        gridX: p.gridX,
        gridY: p.gridY,
        timeZone: p.timeZone,
        ...(place ? { place: `${place.city}, ${place.state}` } : {}),
      },
    };
  }

  async function hourlyForecast(
    grid: WeatherPoint,
    hours: number,
  ): Promise<SourceResult<ForecastPoint[]>> {
    const result = await get(gridUrl(grid.gridId, grid.gridX, grid.gridY), NwsGridSchema);
    if (!result.ok) return result;
    const props = result.data.properties;
    const asOf = utc(props.updateTime);
    const sourceRef = `${grid.gridId}/${grid.gridX},${grid.gridY}`;

    const expanded = new Map<WeatherMetric, Map<string, number | null>>();
    for (const [metric, key] of Object.entries(gridSeries) as [
      WeatherMetric,
      keyof typeof props,
    ][]) {
      const s = props[key];
      if (s === undefined || typeof s === 'string') continue;
      if (wmoUnit(s.uom) === undefined) {
        logger.warn('nws: unknown unit, series skipped', { series: key, unit: s.uom });
        continue;
      }
      const converted = s.values.map((v) => ({
        validTime: v.validTime,
        value: toInternal(metric, v.value, s.uom) ?? null,
      }));
      expanded.set(metric, expandToHours(converted));
    }

    const start = Math.floor(now().getTime() / HOUR) * HOUR;
    const points: ForecastPoint[] = [];
    for (let i = 0; i < hours; i += 1) {
      const time = new Date(start + i * HOUR).toISOString();
      const point: ForecastPoint = { time, values: {}, provenance: {} };
      for (const [metric, byHour] of expanded) {
        // A series that doesn't cover this hour is missing here, not absent from the source.
        point.values[metric] = byHour.get(time) ?? null;
        point.provenance[metric] = { kind: 'forecast', asOf, source: 'nws', sourceRef };
      }
      points.push(ForecastPoint.parse(point));
    }
    return { ok: true, data: points };
  }

  function observationReadings(
    obs: z.infer<typeof NwsObservation>['properties'],
    stationId: string,
    fetchedAt: string,
  ): Reading[] {
    const fields: [WeatherMetric, NwsMeasurement][] = [
      ['airTemp', obs.temperature],
      ['windSpeed', obs.windSpeed],
      ['windGust', obs.windGust],
      ['windDirection', obs.windDirection],
    ];
    const readings: Reading[] = [];
    for (const [metric, m] of fields) {
      const value = m ? toInternal(metric, m.value, m.unitCode) : null;
      if (value === undefined) {
        logger.warn('nws: unknown unit, observation skipped', {
          station: stationId,
          metric,
          unit: m?.unitCode,
        });
        continue;
      }
      const qualifiers: Qualifier[] =
        m?.qualityControl && unreliableQualityCodes.has(m.qualityControl) ? ['unreliable'] : [];
      readings.push(
        Reading.parse({
          metric,
          value,
          observedAt: utc(obs.timestamp),
          fetchedAt,
          source: 'nws',
          sourceRef: stationId,
          ...(qualifiers.length > 0 ? { qualifiers } : {}),
        }),
      );
    }
    return readings;
  }

  return {
    id: 'nws',

    getPoint: point,

    async getHourlyForecast(lat, lon, hours) {
      const grid = await point(lat, lon);
      if (!grid.ok) return grid;
      return hourlyForecast(grid.data, hours);
    },

    async getCurrent(lat, lon) {
      const grid = await point(lat, lon);
      if (!grid.ok) return grid;
      const { gridId, gridX, gridY } = grid.data;
      const fetchedAt = now().toISOString();

      const stations = await get(stationsUrl(gridId, gridX, gridY), NwsStations);
      if (stations.ok) {
        const candidates = stations.data.features
          .map((f) => {
            const [sLon, sLat] = f.geometry.coordinates;
            return {
              id: f.properties.stationIdentifier,
              name: f.properties.name,
              distanceKm: distanceKm(lat, lon, sLat, sLon),
            };
          })
          .filter((s) => s.distanceKm <= STATION_MAX_DISTANCE_KM)
          .sort((a, b) => a.distanceKm - b.distanceKm)
          .slice(0, STATIONS_TRIED);
        for (const station of candidates) {
          const obs = await get(latestObservationUrl(station.id), NwsObservation);
          if (!obs.ok) continue;
          const age = now().getTime() - Date.parse(obs.data.properties.timestamp);
          if (!(age <= STATION_MAX_AGE_HOURS * HOUR)) continue;
          const current: CurrentWeather = {
            basis: 'station',
            station,
            readings: observationReadings(obs.data.properties, station.id, fetchedAt),
          };
          return { ok: true, data: current };
        }
      }

      // No close, fresh station: the forecast's current hour, labeled as forecast.
      const forecast = await hourlyForecast(grid.data, 1);
      if (!forecast.ok) return forecast;
      const hour = forecast.data[0];
      const readings: Reading[] = [];
      for (const [metric, value] of Object.entries(hour?.values ?? {}) as [
        Metric,
        number | null,
      ][]) {
        readings.push({
          metric,
          value,
          observedAt: hour?.time ?? fetchedAt,
          fetchedAt,
          source: 'nws',
          sourceRef: `${gridId}/${gridX},${gridY}`,
        });
      }
      return { ok: true, data: { basis: 'forecast', readings } };
    },

    async getAlerts(lat, lon) {
      const result = await get(alertsUrl(lat, lon), NwsAlerts);
      if (!result.ok) return result;
      const alerts: Alert[] = result.data.features.map(({ properties: a }) => {
        const ends = a.ends ?? a.expires ?? null;
        return {
          id: a.id,
          event: a.event,
          headline: a.headline ?? null,
          severity: (severities as readonly string[]).includes(a.severity)
            ? (a.severity as Alert['severity'])
            : 'Unknown',
          onset: a.onset ? utc(a.onset) : null,
          ends: ends ? utc(ends) : null,
        };
      });
      return { ok: true, data: alerts };
    },
  };
}
