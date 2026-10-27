import { z } from 'zod';
import { GaugeRef, Id } from './measurement.ts';

const LatLon = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

// A stretch of water rowed out and back (#103): points from the start, such as the dock, to the
// turn, following the river. Notes hold local rules, such as which bank to keep to going
// upstream; the app shows them and doesn't model them.
export const Course = z.object({
  points: z.array(LatLon).min(2),
  notes: z.string().trim().max(500).optional(),
});
export type Course = z.infer<typeof Course>;

export const SavedLocation = z.object({
  id: Id,
  name: z.string().trim().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  gaugeRef: GaugeRef.optional(), // default gauge for display; omitted = weather-only
  ruleSetIds: z.array(Id),
  course: Course.optional(),
});
export type SavedLocation = z.infer<typeof SavedLocation>;
