import { z } from 'zod';
import { isValueInRange, Metric, Qualifier, SourceId, UtcTime } from './measurement.ts';

// Negative flow is in range only when marked reversedFlow, which keeps it out of every comparison.
function isReversedFlow(
  metric: Metric,
  value: number,
  qualifiers: readonly Qualifier[] | undefined,
): boolean {
  return metric === 'flow' && value < 0 && (qualifiers ?? []).includes('reversedFlow');
}

export const Reading = z
  .object({
    metric: Metric,
    value: z.number().nullable(), // null = the source reported no value
    observedAt: UtcTime,
    fetchedAt: UtcTime,
    source: SourceId,
    sourceRef: z.string().min(1).optional(),
    qualifiers: z.array(Qualifier).optional(),
  })
  .superRefine((reading, ctx) => {
    if (
      reading.value !== null &&
      !isValueInRange(reading.metric, reading.value) &&
      !isReversedFlow(reading.metric, reading.value, reading.qualifiers)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `Out of range for ${reading.metric}`,
      });
    }
  });
export type Reading = z.infer<typeof Reading>;

export const ValueProvenance = z.object({
  kind: z.enum(['forecast', 'observation']),
  asOf: UtcTime, // forecast issue/update time, or observation time
  source: SourceId,
  sourceRef: z.string().min(1).optional(),
  interpolated: z.boolean().optional(),
  qualifiers: z.array(Qualifier).optional(),
  // Why a null value was left out on purpose, so evaluation can say so rather than 'missing'.
  withheld: z.enum(['noForecast', 'forecastDisagrees']).optional(),
  // With withheld 'forecastDisagrees': the set-aside forecast for this hour and when it was issued.
  // Evaluation may use it for "probably within" (decision 0020), never for plain within.
  setAside: z.object({ value: z.number(), asOf: UtcTime }).optional(),
});
export type ValueProvenance = z.infer<typeof ValueProvenance>;

export const ForecastPoint = z
  .object({
    time: UtcTime, // start of the hour
    values: z.partialRecord(Metric, z.number().nullable()),
    provenance: z.partialRecord(Metric, ValueProvenance), // absent = no source supplies the metric
    // The NWS forecaster's fog call for the hour, as context only (#42): its coverage word, such as
    // "patchy" or "areas"; null when NWS forecasts no fog; absent when the forecast doesn't say.
    fog: z.string().min(1).nullable().optional(),
  })
  .superRefine((point, ctx) => {
    const time = new Date(point.time);
    if (
      time.getUTCMinutes() !== 0 ||
      time.getUTCSeconds() !== 0 ||
      time.getUTCMilliseconds() !== 0
    ) {
      ctx.addIssue({ code: 'custom', path: ['time'], message: 'Must be the start of an hour' });
    }
    for (const [key, value] of Object.entries(point.values)) {
      const metric = key as Metric;
      if (point.provenance[metric] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['provenance', metric],
          message: 'Value has no provenance',
        });
      }
      if (
        typeof value === 'number' &&
        !isValueInRange(metric, value) &&
        !isReversedFlow(metric, value, point.provenance[metric]?.qualifiers)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['values', metric],
          message: `Out of range for ${metric}`,
        });
      }
    }
  });
export type ForecastPoint = z.infer<typeof ForecastPoint>;
