import { z } from 'zod';

// A place found by name search, used to pick a location. Not a reading source.
export const Place = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1), // full name with region, e.g. "Turners Falls, Montague, …"
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type Place = z.infer<typeof Place>;
