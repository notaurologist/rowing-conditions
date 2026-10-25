import { z } from 'zod';
import { fromInternal, roundHalfAwayFromZero, unitDecimals } from '../units/units.ts';
import { GaugeRef, Id, Metric, metricUnits, ratioScaleMetrics, Unit } from './measurement.ts';

export const BoatClass = z.object({
  id: Id,
  name: z.string().trim().min(1), // user-defined per rule set, e.g. "1x and 2x"
});
export type BoatClass = z.infer<typeof BoatClass>;

export const Threshold = z
  .object({
    id: Id,
    metric: Metric,
    comparison: z.enum(['min', 'max']),
    boundary: z.enum(['inclusive', 'exclusive']), // inclusive: a value equal to the limit is within
    value: z.number(), // in the metric's internal unit
    enteredUnit: Unit, // comparisons happen in this unit, at display precision
    boatClassIds: z.array(Id).min(1).optional(), // omitted = every class in the rule set
  })
  .superRefine((t, ctx) => {
    if (!metricUnits[t.metric].includes(t.enteredUnit)) {
      ctx.addIssue({
        code: 'custom',
        path: ['enteredUnit'],
        message: `${t.metric} limits cannot be entered in ${t.enteredUnit}`,
      });
    } else {
      // Limits are compared at display precision, so a more precise limit would be rounded,
      // and a max of 15.5 mph would quietly become 16.
      const entered = fromInternal(t.metric, t.value, t.enteredUnit);
      const rounded = roundHalfAwayFromZero(entered, unitDecimals[t.enteredUnit]);
      if (Math.abs(rounded - entered) > 1e-9 * Math.max(1, Math.abs(entered))) {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message: `More precise than ${t.enteredUnit} is shown (${unitDecimals[t.enteredUnit]} decimals)`,
        });
      }
    }
    if (ratioScaleMetrics.includes(t.metric) && t.value <= 0) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Must be greater than zero' });
    }
    if (t.metric === 'precipChance' && t.value > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Rain chance is a fraction from 0 to 1',
      });
    }
  });
export type Threshold = z.infer<typeof Threshold>;

// Optional hard window, only for clubs that forbid rowing outside it. Light is otherwise context.
export const DaylightWindow = z.object({
  minutesBeforeSunrise: z.number().int(),
  minutesAfterSunset: z.number().int(),
});
export type DaylightWindow = z.infer<typeof DaylightWindow>;

export const RuleSet = z
  .object({
    id: Id,
    name: z.string().trim().min(1), // used in UI copy: "within Club A's limits"
    boatClasses: z.array(BoatClass).min(1),
    thresholds: z.array(Threshold),
    daylight: DaylightWindow.optional(),
    flowGaugeRef: GaugeRef.optional(), // gauge the flow limit is measured at
  })
  .superRefine((ruleSet, ctx) => {
    const classIds = ruleSet.boatClasses.map((c) => c.id);
    if (new Set(classIds).size !== classIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['boatClasses'],
        message: 'Boat class ids must be unique',
      });
    }
    const thresholdIds = ruleSet.thresholds.map((t) => t.id);
    if (new Set(thresholdIds).size !== thresholdIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['thresholds'],
        message: 'Threshold ids must be unique',
      });
    }
    ruleSet.thresholds.forEach((t, i) => {
      for (const id of t.boatClassIds ?? []) {
        if (!classIds.includes(id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['thresholds', i, 'boatClassIds'],
            message: `Unknown boat class ${id}`,
          });
        }
      }
    });
  });
export type RuleSet = z.infer<typeof RuleSet>;
