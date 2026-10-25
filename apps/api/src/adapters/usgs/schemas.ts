import { z } from 'zod';

// USGS Water Data APIs v1 response shapes. Only the fields the adapter uses; others pass through.

const links = z.array(z.object({ rel: z.string(), href: z.string() })).optional();

const point = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]).rest(z.number()), // [lon, lat, (altitude)]
});

export const UsgsLocation = z.object({
  type: z.literal('Feature'),
  id: z.string(),
  geometry: point,
  properties: z.object({ monitoring_location_name: z.string() }),
});

export const UsgsLocations = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(UsgsLocation),
  links,
});

export const UsgsSeriesMetadata = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      properties: z.object({
        monitoring_location_id: z.string(),
        parameter_code: z.string(),
        statistic_id: z.string().nullable(),
      }),
    }),
  ),
  links,
});

export const UsgsReadings = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      properties: z.object({
        monitoring_location_id: z.string(),
        parameter_code: z.string(),
        statistic_id: z.string().nullable(),
        time: z.string(),
        value: z.string().nullable(), // a string, to preserve precision
        unit_of_measure: z.string().nullable(),
        approval_status: z.string().nullable(),
        qualifier: z.array(z.string()).nullable(),
      }),
    }),
  ),
  links,
});
export type UsgsReadings = z.infer<typeof UsgsReadings>;
