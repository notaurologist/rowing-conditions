import { z } from 'zod';

// Nominatim /search with format=jsonv2. Only the fields the adapter reads; others pass through.
// Coordinates arrive as strings.
export const NominatimPlace = z.object({
  place_id: z.number(),
  lat: z.string(),
  lon: z.string(),
  name: z.string().optional(),
  display_name: z.string().min(1),
});
export type NominatimPlace = z.infer<typeof NominatimPlace>;

export const NominatimSearch = z.array(NominatimPlace);
