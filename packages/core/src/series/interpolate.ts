const HOUR = 3_600_000;

export interface Step {
  time: string; // ISO 8601, UTC
  value: number | null;
}

export interface HourlyValue extends Step {
  interpolated: boolean; // false only where a step falls exactly on the hour
}

// Hourly values between the first and last step, linear between steps. Never extrapolates.
// An hour between two steps is null if either step is null.
export function interpolateHourly(steps: readonly Step[]): HourlyValue[] {
  const sorted = steps
    .map((s) => ({ ms: Date.parse(s.time), value: s.value }))
    .sort((a, b) => a.ms - b.ms);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) return [];

  const result: HourlyValue[] = [];
  let next = 0;
  for (let hour = Math.ceil(first.ms / HOUR) * HOUR; hour <= last.ms; hour += HOUR) {
    while ((sorted[next]?.ms ?? Infinity) < hour) next += 1;
    const after = sorted[next];
    const time = new Date(hour).toISOString();
    if (after !== undefined && after.ms === hour) {
      result.push({ time, value: after.value, interpolated: false });
      continue;
    }
    const before = sorted[next - 1];
    if (
      before === undefined ||
      after === undefined ||
      before.value === null ||
      after.value === null
    ) {
      result.push({ time, value: null, interpolated: true });
      continue;
    }
    const fraction = (hour - before.ms) / (after.ms - before.ms);
    result.push({
      time,
      value: before.value + (after.value - before.value) * fraction,
      interpolated: true,
    });
  }
  return result;
}
