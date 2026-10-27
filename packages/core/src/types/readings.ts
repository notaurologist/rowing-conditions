import { z } from 'zod';
import { isValueInRange, Metric, Qualifier, SourceId, UtcTime } from './measurement.ts';

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
    if (reading.value !== null && !isValueInRange(reading.metric, reading.value)) {
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
});
export type ValueProvenance = z.infer<typeof ValueProvenance>;

export const ForecastPoint = z
  .object({
    time: UtcTime, // start of the hour
    values: z.partialRecord(Metric, z.number().nullable()),
    provenance: z.partialRecord(Metric, ValueProvenance), // absent = no source supplies the metric
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
      if (typeof value === 'number' && !isValueInRange(metric, value)) {
        ctx.addIssue({
          code: 'custom',
          path: ['values', metric],
          message: `Out of range for ${metric}`,
        });
      }
    }
  });
export type ForecastPoint = z.infer<typeof ForecastPoint>;
