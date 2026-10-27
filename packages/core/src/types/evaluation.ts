import { z } from 'zod';
import { Id, Metric, Unit, UtcTime } from './measurement.ts';

// Probably within: within every limit, but at least one value is one the app has a named reason to
// doubt, such as a flow forecast that disagrees with the gauge (decision 0020).
export const EvaluationStatus = z.enum(['within', 'probablyWithin', 'outside', 'unknown']);
export type EvaluationStatus = z.infer<typeof EvaluationStatus>;

export const UnknownReason = z.enum([
  'missing', // the source supplies the metric but has no value for this hour
  'stale', // older than the metric's maximum age
  'qualified', // carries a qualifier that makes it unreliable
  'reversed', // negative flow: the river running backward, shown but never compared (#116)
  'noSource', // no source at this location reports the metric
  'noForecast', // no forecast for this hour, and the last reading is too far back to stand in (#117)
  'forecastDisagrees', // the forecast was set aside: it disagreed with the latest reading (#82)
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
    doubtful: z.literal(true).optional(), // the value is one the app doubts (decision 0020)
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
  // Limits met or failed on a value the app doubts, and why (decision 0020).
  doubtful: z
    .array(z.object({ thresholdId: Id, metric: Metric, reason: z.literal('forecastDisagrees') }))
    .optional(),
});
export type HourResult = z.infer<typeof HourResult>;
