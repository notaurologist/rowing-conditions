import { z } from 'zod';
import { Id, Metric, Unit, UtcTime } from './measurement.ts';

export const EvaluationStatus = z.enum(['within', 'outside', 'unknown']);
export type EvaluationStatus = z.infer<typeof EvaluationStatus>;

export const UnknownReason = z.enum([
  'missing', // the source supplies the metric but has no value for this hour
  'stale', // older than the metric's maximum age
  'qualified', // carries a qualifier that makes it unreliable
  'noSource', // no source at this location reports the metric
]);
export type UnknownReason = z.infer<typeof UnknownReason>;

// Context only; never affects status. Twilight is civil twilight.
export const LightLevel = z.enum(['daylight', 'twilight', 'dark']);
export type LightLevel = z.infer<typeof LightLevel>;

export const Failure = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('limit'),
    thresholdId: Id,
    metric: Metric,
    value: z.number(), // rounded, in unit
    limit: z.number(), // rounded, in unit
    unit: Unit,
  }),
  z.object({ kind: z.literal('daylight') }), // hour entirely outside the daylight window
]);
export type Failure = z.infer<typeof Failure>;

export const HourResult = z.object({
  time: UtcTime,
  status: EvaluationStatus,
  light: LightLevel,
  failures: z.array(Failure),
  unknowns: z.array(z.object({ thresholdId: Id, metric: Metric, reason: UnknownReason })),
});
export type HourResult = z.infer<typeof HourResult>;
