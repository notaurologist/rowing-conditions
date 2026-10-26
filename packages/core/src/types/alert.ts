import { z } from 'zod';
import { UtcTime } from './measurement.ts';

// A weather alert, shown alongside conditions. Never turned into a verdict.
export const Alert = z.object({
  id: z.string().min(1),
  event: z.string().min(1), // e.g. "Winter Weather Advisory"
  headline: z.string().nullable(),
  severity: z.enum(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']),
  onset: UtcTime.nullable(),
  ends: UtcTime.nullable(), // falls back to the alert's expiry when the source gives no end
});
export type Alert = z.infer<typeof Alert>;
