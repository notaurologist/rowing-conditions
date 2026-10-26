import { z } from 'zod';

// National Weather Service API response shapes. Only the fields the adapter uses.

export const NwsPoint = z.object({
  properties: z.object({
    gridId: z.string(),
    gridX: z.number().int(),
    gridY: z.number().int(),
    timeZone: z.string(),
    relativeLocation: z
      .object({ properties: z.object({ city: z.string(), state: z.string() }) })
      .optional(),
  }),
});

const series = z.object({
  uom: z.string(),
  values: z.array(z.object({ validTime: z.string(), value: z.number().nullable() })),
});

export const NwsGrid = z.object({
  properties: z.object({
    updateTime: z.string(),
    temperature: series.optional(),
    windSpeed: series.optional(),
    windGust: series.optional(),
    windDirection: series.optional(),
    probabilityOfPrecipitation: series.optional(),
  }),
});
export type NwsGrid = z.infer<typeof NwsGrid>;

export const NwsStations = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]).rest(z.number()) }),
      properties: z.object({ stationIdentifier: z.string(), name: z.string() }),
    }),
  ),
});

const measurement = z
  .object({
    unitCode: z.string(),
    value: z.number().nullable(),
    qualityControl: z.string().optional(),
  })
  .nullable()
  .optional();
export type NwsMeasurement = z.infer<typeof measurement>;

export const NwsObservation = z.object({
  properties: z.object({
    timestamp: z.string(),
    temperature: measurement,
    windSpeed: measurement,
    windGust: measurement,
    windDirection: measurement,
  }),
});

export const NwsAlerts = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        id: z.string(),
        event: z.string(),
        headline: z.string().nullable().optional(),
        severity: z.string(),
        onset: z.string().nullable().optional(),
        ends: z.string().nullable().optional(),
        expires: z.string().nullable().optional(),
      }),
    }),
  ),
});
