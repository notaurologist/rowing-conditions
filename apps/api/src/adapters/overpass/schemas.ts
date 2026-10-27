import { z } from 'zod';

// Overpass API response shape for `out body geom` on ways. Only the fields the adapter uses.
export const OverpassWays = z.object({
  elements: z.array(
    z.object({
      type: z.literal('way'),
      id: z.number().int(),
      nodes: z.array(z.number().int()),
      geometry: z.array(z.object({ lat: z.number(), lon: z.number() }).nullable()),
      tags: z.record(z.string(), z.string()).optional(),
    }),
  ),
});
export type OverpassWays = z.infer<typeof OverpassWays>;
