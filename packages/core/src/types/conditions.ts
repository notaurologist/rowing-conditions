import { z } from 'zod';
import { DaylightTimes } from '../daylight/daylight.ts';
import { Trend } from '../series/trend.ts';
import { Alert } from './alert.ts';
import { Gauge } from './gauge.ts';
import { SourceId, UtcTime } from './measurement.ts';
import { ForecastPoint, Reading } from './readings.ts';

export const SourceStatus = z.object({
  id: SourceId,
  status: z.enum(['ok', 'stale', 'error']),
  fetchedAt: UtcTime.optional(), // the oldest data from this source in the response
  message: z.string().optional(),
});
export type SourceStatus = z.infer<typeof SourceStatus>;

// A flow forecast set aside because it disagreed with the latest reading (#82), kept so the app
// can show it, dashed and never compared against limits (#144). Values are m³/s.
export const FlowSetAside = z.object({
  gaugeRef: z.string(),
  issuedAt: UtcTime,
  measured: z.number(),
  measuredAt: UtcTime,
  forecastForMeasurement: z.number(), // what the forecast had for the measurement's hour
  points: z.array(z.object({ time: UtcTime, flow: z.number() })), // forecast hours in the window
});
export type FlowSetAside = z.infer<typeof FlowSetAside>;

// The /conditions response. Here rather than in the API so a client can re-validate a copy
// it kept, such as the web app's last loaded conditions for offline use.
export const ConditionsResponse = z.object({
  location: z.object({
    lat: z.number(),
    lon: z.number(),
    timezone: z.string().nullable(), // IANA, from NWS; null if unavailable
    place: z.string().optional(),
  }),
  gauge: Gauge.pick({ ref: true, name: true, lat: true, lon: true }).optional(),
  current: z.array(Reading),
  // Flow and gauge height trends at the display gauge, one per metric the gauge reports. Defaults
  // to none so a copy kept from before trends were added still parses.
  trends: z.array(Trend).default([]),
  // Set-aside flow forecasts for the display gauge and rule-set gauges. Defaults to none so a copy
  // kept from before it existed still parses.
  flowSetAside: z.array(FlowSetAside).default([]),
  currentBasis: z.enum(['station', 'forecast']).optional(),
  station: z.object({ id: z.string(), name: z.string(), distanceKm: z.number() }).optional(),
  forecast: z.array(ForecastPoint), // hourly points from the current hour
  // Flow from gauges named by rule sets. name is absent when the gauge's metadata didn't load.
  flowSeries: z.array(
    z.object({ gaugeRef: z.string(), name: z.string().optional(), points: z.array(ForecastPoint) }),
  ),
  daylight: z.array(DaylightTimes),
  alerts: z.array(Alert),
  sources: z.array(SourceStatus),
});
export type ConditionsResponse = z.infer<typeof ConditionsResponse>;
