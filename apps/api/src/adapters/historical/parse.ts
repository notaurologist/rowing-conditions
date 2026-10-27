// Parsers for the backtesting-only sources in decision 0019. They read recorded response bodies,
// check them with Zod, and convert to SI. Never used by the live app. See docs/DATA_SOURCES.md.

import type { Metric } from '@rowing/core';
import { z } from 'zod';
import { FORECAST_LEADS_DAYS } from './requests.ts';

export type WeatherMetric = Extract<
  Metric,
  'airTemp' | 'windSpeed' | 'windGust' | 'windDirection' | 'precipChance'
>;

export type WeatherValues = Partial<Record<WeatherMetric, number | null>>;

export interface ModelHour {
  time: string; // ISO 8601 UTC, start of the hour
  values: WeatherValues;
}

export type ForecastLead = (typeof FORECAST_LEADS_DAYS)[number];

export interface PreviousRuns {
  gridLat: number; // the grid point used, not the requested point
  gridLon: number;
  byLead: Record<ForecastLead, ModelHour[]>;
}

export interface ModeledHistory {
  gridLat: number;
  gridLon: number;
  hours: ModelHour[];
}

export interface AsosReport {
  station: string; // IEM ID, e.g. ORE
  time: string; // ISO 8601 UTC
  lat: number;
  lon: number;
  values: Partial<Record<Exclude<WeatherMetric, 'precipChance'>, number | null>>;
}

const variableByMetric: Record<WeatherMetric, string> = {
  airTemp: 'temperature_2m',
  windSpeed: 'wind_speed_10m',
  windGust: 'wind_gusts_10m',
  windDirection: 'wind_direction_10m',
  precipChance: 'precipitation_probability',
};

// The units the requests ask for. Anything else means the request or the API changed.
const expectedUnits: Record<WeatherMetric, string> = {
  airTemp: '°C',
  windSpeed: 'm/s',
  windGust: 'm/s',
  windDirection: '°',
  precipChance: '%',
};

const OpenMeteoResponse = z.object({
  latitude: z.number(),
  longitude: z.number(),
  hourly_units: z.record(z.string(), z.string()),
  hourly: z
    .object({ time: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) })
    .catchall(z.array(z.number().nullable())),
});
type OpenMeteoResponse = z.infer<typeof OpenMeteoResponse>;

// Open-Meteo times have no offset; the requests ask for GMT.
const openMeteoTime = (time: string) => new Date(`${time}:00Z`).toISOString();

// Degrees from 0 to just under 360. Sources report north as 360.
const normalizeDirection = (degrees: number) => ((degrees % 360) + 360) % 360;

function toSI(metric: WeatherMetric, value: number | null): number | null {
  if (value === null) return null;
  if (metric === 'precipChance') return value / 100;
  if (metric === 'windDirection') return normalizeDirection(value);
  return value;
}

function hoursOf(
  response: OpenMeteoResponse,
  metrics: readonly WeatherMetric[],
  suffix: string,
): ModelHour[] {
  for (const metric of metrics) {
    const name = `${variableByMetric[metric]}${suffix}`;
    const series = response.hourly[name];
    if (!Array.isArray(series) || series.length !== response.hourly.time.length) {
      throw new Error(`open-meteo: ${name} is missing or a different length from time`);
    }
    const unit = response.hourly_units[name];
    if (unit !== expectedUnits[metric]) {
      throw new Error(`open-meteo: ${name} is in ${unit}, expected ${expectedUnits[metric]}`);
    }
  }
  return response.hourly.time.map((time, i) => {
    const values: WeatherValues = {};
    for (const metric of metrics) {
      const series = response.hourly[`${variableByMetric[metric]}${suffix}`] as (number | null)[];
      values[metric] = toSI(metric, series[i] ?? null);
    }
    return { time: openMeteoTime(time), values };
  });
}

const forecastMetrics: readonly WeatherMetric[] = [
  'airTemp',
  'windSpeed',
  'windGust',
  'windDirection',
  'precipChance',
];

// Throws when the body doesn't match what previousRunsUrl asks for.
export function parsePreviousRuns(body: unknown): PreviousRuns {
  const response = OpenMeteoResponse.parse(body);
  const byLead = Object.fromEntries(
    FORECAST_LEADS_DAYS.map((days) => [
      days,
      hoursOf(response, forecastMetrics, `_previous_day${days}`),
    ]),
  ) as Record<ForecastLead, ModelHour[]>;
  return { gridLat: response.latitude, gridLon: response.longitude, byLead };
}

// Throws when the body doesn't match what archiveUrl asks for. No chance of rain: it's history.
export function parseModeledHistory(body: unknown): ModeledHistory {
  const response = OpenMeteoResponse.parse(body);
  const metrics: WeatherMetric[] = ['airTemp', 'windSpeed', 'windGust', 'windDirection'];
  return {
    gridLat: response.latitude,
    gridLon: response.longitude,
    hours: hoursOf(response, metrics, ''),
  };
}

const KNOT_IN_M_PER_S = 1852 / 3600;

const asosColumns = ['station', 'valid', 'lon', 'lat', 'tmpc', 'sknt', 'gust', 'drct'];

// Blank means missing, failed a check, or never reported. All are unknown (decision 0019).
const optionalNumber = z
  .string()
  .transform((s) => (s.trim() === '' ? null : Number(s)))
  .refine((n) => n === null || Number.isFinite(n), 'Not a number');

const AsosRow = z.object({
  station: z.string().min(1),
  valid: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
  lon: z.coerce.number(),
  lat: z.coerce.number(),
  tmpc: optionalNumber,
  sknt: optionalNumber,
  gust: optionalNumber,
  drct: optionalNumber,
});

const knotsToSI = (knots: number | null) => (knots === null ? null : knots * KNOT_IN_M_PER_S);

// Throws when the CSV doesn't have the columns asosUrl asks for, or a row doesn't parse.
export function parseAsos(csv: unknown): AsosReport[] {
  const lines = z
    .string()
    .parse(csv)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const header = lines[0]?.split(',');
  if (header?.join(',') !== asosColumns.join(',')) {
    throw new Error(`iem: unexpected columns ${header?.join(',') ?? '(none)'}`);
  }
  return lines.slice(1).map((line, i) => {
    const cells = line.split(',');
    const parsed = AsosRow.safeParse(Object.fromEntries(asosColumns.map((c, j) => [c, cells[j]])));
    if (!parsed.success) {
      throw new Error(`iem: row ${i + 1} did not parse: ${parsed.error.issues[0]?.message}`);
    }
    const row = parsed.data;
    return {
      station: row.station,
      time: new Date(`${row.valid.replace(' ', 'T')}:00Z`).toISOString(),
      lat: row.lat,
      lon: row.lon,
      values: {
        airTemp: row.tmpc,
        windSpeed: knotsToSI(row.sknt),
        windGust: knotsToSI(row.gust),
        windDirection: row.drct === null ? null : normalizeDirection(row.drct),
      },
    };
  });
}
