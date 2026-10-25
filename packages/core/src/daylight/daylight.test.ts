import { describe, expect, it } from 'vitest';
import {
  DaylightTimes,
  daylightTimes,
  daylightWindowSpan,
  hourLightLevel,
  hourOverlapsCivilDaylight,
} from './daylight.ts';

// Reference times from the US Naval Observatory (aa.usno.navy.mil/api/rstt/oneday), UTC,
// recorded October 2026.
const turnersFalls = { lat: 42.6, lon: -72.55 };
const utqiagvik = { lat: 71.29, lon: -156.79 };

const MINUTE = 60_000;

function expectWithinMinutes(actual: string | null, expected: string, minutes = 2) {
  expect(actual).not.toBeNull();
  const diff = Math.abs(Date.parse(actual as string) - Date.parse(expected));
  expect(diff, `${actual} vs ${expected}`).toBeLessThanOrEqual(minutes * MINUTE);
}

function hourStartingAt(ms: number): string {
  return new Date(ms).toISOString();
}

describe('daylightTimes', () => {
  it('matches USNO for a winter day in Massachusetts', () => {
    const t = daylightTimes('2026-12-21', turnersFalls.lat, turnersFalls.lon);
    expect(t.sun).toBe('risesAndSets');
    expectWithinMinutes(t.civilDawn, '2026-12-21T11:45:00Z');
    expectWithinMinutes(t.sunrise, '2026-12-21T12:17:00Z');
    expectWithinMinutes(t.sunset, '2026-12-21T21:20:00Z');
    expectWithinMinutes(t.civilDusk, '2026-12-21T21:52:00Z');
  });

  it('keeps an evening sunset that falls on the next UTC date with its local day', () => {
    const t = daylightTimes('2026-06-21', turnersFalls.lat, turnersFalls.lon);
    expectWithinMinutes(t.civilDawn, '2026-06-21T08:38:00Z');
    expectWithinMinutes(t.sunrise, '2026-06-21T09:13:00Z');
    expectWithinMinutes(t.sunset, '2026-06-22T00:31:00Z');
    expectWithinMinutes(t.civilDusk, '2026-06-22T01:06:00Z');
  });

  it('reports polar day with no event times', () => {
    const t = daylightTimes('2026-06-21', utqiagvik.lat, utqiagvik.lon);
    expect(t).toEqual({
      date: '2026-06-21',
      sun: 'alwaysUp',
      civilDawn: null,
      sunrise: null,
      sunset: null,
      civilDusk: null,
    });
  });

  it('reports polar night that still has civil twilight', () => {
    const t = daylightTimes('2026-12-21', utqiagvik.lat, utqiagvik.lon);
    expect(t.sun).toBe('alwaysDown');
    expect(t.sunrise).toBeNull();
    expect(t.sunset).toBeNull();
    expectWithinMinutes(t.civilDawn, '2026-12-21T20:56:00Z');
    expectWithinMinutes(t.civilDusk, '2026-12-21T23:55:00Z');
  });

  it('returns UTC times that pass the DaylightTimes schema', () => {
    const t = daylightTimes('2026-12-21', turnersFalls.lat, turnersFalls.lon);
    expect(DaylightTimes.safeParse(t).success).toBe(true);
    expect(t.sunrise).toMatch(/Z$/);
  });

  it('rejects a malformed date', () => {
    expect(() => daylightTimes('2026-13-01', turnersFalls.lat, turnersFalls.lon)).toThrow();
    expect(() => daylightTimes('Dec 21', turnersFalls.lat, turnersFalls.lon)).toThrow();
  });
});

describe('hourLightLevel', () => {
  const { lat, lon } = turnersFalls;
  const winter = daylightTimes('2026-12-21', lat, lon);
  const at = (iso: string | null) => Date.parse(iso as string);
  // The level is taken at the middle of the hour, so an hour starting 31 minutes before an
  // event is measured 1 minute before it.
  const before = (iso: string | null) => hourStartingAt(at(iso) - 31 * MINUTE);
  const after = (iso: string | null) => hourStartingAt(at(iso) - 29 * MINUTE);

  it('is daylight at midday and dark at night', () => {
    expect(hourLightLevel('2026-12-21T17:00:00Z', lat, lon)).toBe('daylight');
    expect(hourLightLevel('2026-12-21T03:00:00Z', lat, lon)).toBe('dark');
    expect(hourLightLevel('2026-12-22T04:00:00Z', lat, lon)).toBe('dark');
  });

  it('changes from dark to twilight at civil dawn', () => {
    expect(hourLightLevel(before(winter.civilDawn), lat, lon)).toBe('dark');
    expect(hourLightLevel(after(winter.civilDawn), lat, lon)).toBe('twilight');
  });

  it('changes from twilight to daylight at sunrise', () => {
    expect(hourLightLevel(before(winter.sunrise), lat, lon)).toBe('twilight');
    expect(hourLightLevel(after(winter.sunrise), lat, lon)).toBe('daylight');
  });

  it('changes from daylight to twilight at sunset', () => {
    expect(hourLightLevel(before(winter.sunset), lat, lon)).toBe('daylight');
    expect(hourLightLevel(after(winter.sunset), lat, lon)).toBe('twilight');
  });

  it('changes from twilight to dark at civil dusk', () => {
    expect(hourLightLevel(before(winter.civilDusk), lat, lon)).toBe('twilight');
    expect(hourLightLevel(after(winter.civilDusk), lat, lon)).toBe('dark');
  });

  it('handles a summer evening whose dusk falls on the next UTC date', () => {
    // Sunset is about 00:31Z and civil dusk about 01:06Z on June 22.
    expect(hourLightLevel('2026-06-21T23:30:00Z', lat, lon)).toBe('daylight'); // at 00:00Z
    expect(hourLightLevel('2026-06-22T00:15:00Z', lat, lon)).toBe('twilight'); // at 00:45Z
    expect(hourLightLevel('2026-06-22T01:00:00Z', lat, lon)).toBe('dark'); // at 01:30Z
  });

  it('is daylight at midnight during polar day', () => {
    expect(hourLightLevel('2026-06-21T10:00:00Z', utqiagvik.lat, utqiagvik.lon)).toBe('daylight');
  });

  it('is twilight at midday and dark at night during polar night', () => {
    expect(hourLightLevel('2026-12-21T22:00:00Z', utqiagvik.lat, utqiagvik.lon)).toBe('twilight');
    expect(hourLightLevel('2026-12-21T10:00:00Z', utqiagvik.lat, utqiagvik.lon)).toBe('dark');
  });

  it('is twilight all night when the Sun never drops below -6° (Fairbanks in June)', () => {
    // 01:30 local, between sunset (00:48) and sunrise (02:58); civil twilight never ends.
    expect(hourLightLevel('2026-06-21T09:00:00Z', 64.84, -147.72)).toBe('twilight');
  });

  it('is dark when the Sun never rises above -6° (85°N in December)', () => {
    expect(hourLightLevel('2026-12-21T12:00:00Z', 85, 0)).toBe('dark');
  });

  it('is dark in nautical-only twilight (Svalbard at midday in December, Sun at -11°)', () => {
    expect(hourLightLevel('2026-12-21T11:00:00Z', 78.22, 15.65)).toBe('dark');
  });
});

describe('daylightTimes date selection', () => {
  // Each event must fall on the requested date in local solar time. Picking the wrong solar
  // day moves sunrise by only a minute or two near the solstices, so check the date itself.
  it.each([
    ['Massachusetts', 42.6, -72.55],
    ['Seattle', 47.6, -122.33],
    ['London', 51.5, -0.12],
    ['Tokyo', 35.68, 139.69],
  ])('puts sunrise on the requested local date in %s', (_, lat, lon) => {
    for (const date of ['2026-03-20', '2026-06-21', '2026-09-22', '2026-12-21']) {
      const { sunrise } = daylightTimes(date, lat, lon);
      const localSolar = new Date(Date.parse(sunrise as string) + (lon / 15) * 3_600_000);
      expect(localSolar.toISOString().slice(0, 10), `${date} sunrise ${sunrise}`).toBe(date);
    }
  });
});

describe('daylightWindowSpan', () => {
  const { lat, lon } = turnersFalls;
  const window = { minutesBeforeSunrise: 60, minutesAfterSunset: 30 };

  it('runs from the offset before sunrise to the offset after sunset of that solar day', () => {
    const t = daylightTimes('2026-12-21', lat, lon);
    const span = daylightWindowSpan('2026-12-21T17:00:00Z', lat, lon, window);
    expect(span).toEqual({
      kind: 'span',
      start: new Date(Date.parse(t.sunrise as string) - 60 * MINUTE).toISOString(),
      end: new Date(Date.parse(t.sunset as string) + 30 * MINUTE).toISOString(),
    });
  });

  it('accepts negative offsets, for windows that start after sunrise', () => {
    const t = daylightTimes('2026-12-21', lat, lon);
    const span = daylightWindowSpan('2026-12-21T17:00:00Z', lat, lon, {
      minutesBeforeSunrise: -30,
      minutesAfterSunset: 0,
    });
    expect(span).toMatchObject({
      start: new Date(Date.parse(t.sunrise as string) + 30 * MINUTE).toISOString(),
      end: t.sunset,
    });
  });

  it('covers the whole day during polar day and none of it during polar night', () => {
    expect(
      daylightWindowSpan('2026-06-21T10:00:00Z', utqiagvik.lat, utqiagvik.lon, window),
    ).toEqual({ kind: 'allDay' });
    expect(
      daylightWindowSpan('2026-12-21T22:00:00Z', utqiagvik.lat, utqiagvik.lon, window),
    ).toEqual({ kind: 'none' });
  });
});

describe('hourOverlapsCivilDaylight', () => {
  const { lat, lon } = turnersFalls;
  const winter = daylightTimes('2026-12-21', lat, lon);
  const dawn = Date.parse(winter.civilDawn as string);
  const dusk = Date.parse(winter.civilDusk as string);
  const hourAt = (ms: number) => new Date(ms).toISOString();

  it('includes midday and excludes the middle of the night', () => {
    expect(hourOverlapsCivilDaylight('2026-12-21T17:00:00Z', lat, lon)).toBe(true);
    expect(hourOverlapsCivilDaylight('2026-12-21T05:00:00Z', lat, lon)).toBe(false);
  });

  it('includes an hour that overlaps civil dawn by any amount, and excludes one ending at it', () => {
    expect(hourOverlapsCivilDaylight(hourAt(dawn - 59 * MINUTE), lat, lon)).toBe(true);
    expect(hourOverlapsCivilDaylight(hourAt(dawn - 60 * MINUTE), lat, lon)).toBe(false);
  });

  it('includes an hour starting before civil dusk, and excludes one starting at it', () => {
    expect(hourOverlapsCivilDaylight(hourAt(dusk - MINUTE), lat, lon)).toBe(true);
    expect(hourOverlapsCivilDaylight(hourAt(dusk), lat, lon)).toBe(false);
  });

  it('handles polar day, white nights, and deep polar night', () => {
    expect(hourOverlapsCivilDaylight('2026-06-21T10:00:00Z', utqiagvik.lat, utqiagvik.lon)).toBe(
      true,
    );
    expect(hourOverlapsCivilDaylight('2026-06-21T09:00:00Z', 64.84, -147.72)).toBe(true);
    expect(hourOverlapsCivilDaylight('2026-12-21T12:00:00Z', 85, 0)).toBe(false);
  });
});
