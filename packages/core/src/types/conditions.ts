import { z } from 'zod';
import { DaylightTimes } from '../daylight/daylight.ts';
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
