import { z } from 'zod';
import { GaugeRef, Id } from './measurement.ts';

export const SavedLocation = z.object({
  id: Id,
  name: z.string().trim().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  gaugeRef: GaugeRef.optional(), // default gauge for display; omitted = weather-only
  ruleSetIds: z.array(Id),
});
export type SavedLocation = z.infer<typeof SavedLocation>;
