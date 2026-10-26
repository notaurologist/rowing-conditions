import type { Unit } from '@rowing/core';

const HOUR = 3_600_000;

// ISO 8601 durations as NWS uses them: days, hours, and minutes (P1D, PT3H, P2DT22H, PT90M).
export function durationMs(duration: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(duration);
  if (!match || duration === 'P' || duration.endsWith('T')) return null;
  const [, days = '0', hours = '0', minutes = '0'] = match;
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60_000;
}

// Expands NWS grid values ("start/duration") to one value per UTC hour each interval covers.
// Hours no interval covers are absent; entries that can't be parsed are skipped.
export function expandToHours(
  values: readonly { validTime: string; value: number | null }[],
): Map<string, number | null> {
  const hours = new Map<string, number | null>();
  for (const { validTime, value } of values) {
    const [start, duration] = validTime.split('/');
    const startMs = Date.parse(start ?? '');
    const length = durationMs(duration ?? '');
    if (Number.isNaN(startMs) || length === null) continue;
    for (let hour = Math.ceil(startMs / HOUR) * HOUR; hour < startMs + length; hour += HOUR) {
      hours.set(new Date(hour).toISOString(), value);
    }
  }
  return hours;
}

// WMO unit codes NWS uses. Wind direction is in degrees, which isn't a limit unit.
const wmoUnits: Record<string, Unit | 'degrees'> = {
  'wmoUnit:degC': 'degC',
  'wmoUnit:degF': 'degF',
  'wmoUnit:km_h-1': 'km/h',
  'wmoUnit:m_s-1': 'm/s',
  'wmoUnit:percent': 'percent',
  'wmoUnit:degree_(angle)': 'degrees',
};

export function wmoUnit(code: string | null | undefined): Unit | 'degrees' | undefined {
  return code ? wmoUnits[code] : undefined;
}
