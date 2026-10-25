import { z } from 'zod';

// NWPS API response shapes. Only the fields the adapter uses; others pass through.

const pedts = z.object({ observed: z.string(), forecast: z.string() }); // forecast is '' when none

export const NwpsGauge = z.object({
  lid: z.string(),
  usgsId: z.string().nullable().optional(), // absent from list entries
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  pedts,
  inService: z.object({ enabled: z.boolean() }).optional(),
});
export type NwpsGauge = z.infer<typeof NwpsGauge>;

export const NwpsGaugeList = z.object({ gauges: z.array(NwpsGauge) });

const series = z.object({
  issuedTime: z.string(), // '0001-01-01T00:00:00Z' when there is no forecast
  primaryUnits: z.string(), // stage, e.g. 'ft'
  secondaryUnits: z.string(), // flow, e.g. 'kcfs'
  data: z.array(
    z.object({
      validTime: z.string(),
      primary: z.number(), // -999 means missing
      secondary: z.number(),
    }),
  ),
});
export type NwpsSeries = z.infer<typeof series>;

export const NwpsStageFlow = z.object({ observed: series, forecast: series });
