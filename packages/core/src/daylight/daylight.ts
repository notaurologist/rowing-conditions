import { getPosition, getTimes, type SunTimes } from 'suncalc';
import { z } from 'zod';
import type { LightLevel } from '../types/evaluation.ts';
import { UtcTime } from '../types/measurement.ts';
import type { DaylightWindow } from '../types/rules.ts';

export const DaylightTimes = z.object({
  date: z.iso.date(), // the location's local date
  sun: z.enum(['risesAndSets', 'alwaysUp', 'alwaysDown']),
  civilDawn: UtcTime.nullable(), // null when the Sun never crosses -6° that day
  sunrise: UtcTime.nullable(),
  sunset: UtcTime.nullable(),
  civilDusk: UtcTime.nullable(),
});
export type DaylightTimes = z.infer<typeof DaylightTimes>;

const HOUR = 3_600_000;

// suncalc returns events for the solar day (nadir to nadir) containing the given instant, so
// asking at local solar noon selects the local date without needing a time zone.
function approximateSolarNoon(date: string, lon: number): Date {
  const parsed = DaylightTimes.shape.date.parse(date);
  const [y, m, d] = parsed.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12) - (lon / 15) * HOUR);
}

function iso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

export function daylightTimes(date: string, lat: number, lon: number): DaylightTimes {
  const times = getTimes(approximateSolarNoon(date, lon), lat, lon);
  return {
    date,
    sun: times.alwaysUp ? 'alwaysUp' : times.alwaysDown ? 'alwaysDown' : 'risesAndSets',
    civilDawn: iso(times.dawn),
    sunrise: iso(times.sunrise),
    sunset: iso(times.sunset),
    civilDusk: iso(times.dusk),
  };
}

function between(t: number, start: Date, end: Date): boolean {
  return start.getTime() <= t && t < end.getTime();
}

// Light level at the middle of the hour starting at `hourStart`.
export function hourLightLevel(hourStart: string, lat: number, lon: number): LightLevel {
  const t = Date.parse(UtcTime.parse(hourStart)) + HOUR / 2;
  const times: SunTimes = getTimes(new Date(t), lat, lon);

  // suncalc sets alwaysUp or alwaysDown whenever sunrise or sunset is missing.
  if (times.alwaysUp) return 'daylight';
  if (times.sunrise && times.sunset && between(t, times.sunrise, times.sunset)) return 'daylight';

  if (times.dawn && times.dusk) return between(t, times.dawn, times.dusk) ? 'twilight' : 'dark';

  // The Sun never crosses -6° today: it stays above (white nights) or below (deep polar night).
  // suncalc's position altitude includes refraction, which is near zero this far below the horizon.
  return getPosition(new Date(t), lat, lon).altitude > -6 ? 'twilight' : 'dark';
}

export type DaylightWindowSpan =
  | { kind: 'span'; start: string; end: string }
  | { kind: 'allDay' } // polar day: the window has no sunrise or sunset to measure from
  | { kind: 'none' }; // polar night

// A rule set's daylight window for the solar day containing the middle of the hour.
export function daylightWindowSpan(
  hourStart: string,
  lat: number,
  lon: number,
  window: DaylightWindow,
): DaylightWindowSpan {
  const t = Date.parse(UtcTime.parse(hourStart)) + HOUR / 2;
  const times = getTimes(new Date(t), lat, lon);
  if (times.alwaysUp) return { kind: 'allDay' };
  if (!times.sunrise || !times.sunset) return { kind: 'none' };
  return {
    kind: 'span',
    start: new Date(times.sunrise.getTime() - window.minutesBeforeSunrise * 60_000).toISOString(),
    end: new Date(times.sunset.getTime() + window.minutesAfterSunset * 60_000).toISOString(),
  };
}
