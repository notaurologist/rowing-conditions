import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../test/fixtures.ts';
import { parseAsos, parseModeledHistory, parsePreviousRuns } from './parse.ts';

const previousRuns = () => loadFixture('historical/previous-runs-turners-falls').body;
const archive = () => loadFixture('historical/archive-turners-falls').body;
const asos = () => loadFixture('historical/asos-ore').body as string;

// A deep copy to change, so one test's edits don't leak into another.
const copy = <T>(value: T): T => structuredClone(value);

describe('parsePreviousRuns', () => {
  const parsed = parsePreviousRuns(previousRuns());

  it('reads every hour of the window for both leads, in UTC', () => {
    for (const lead of [1, 2] as const) {
      const hours = parsed.byLead[lead];
      expect(hours).toHaveLength(96);
      expect(hours[0]?.time).toBe('2026-05-14T00:00:00.000Z');
      expect(hours.at(-1)?.time).toBe('2026-05-17T23:00:00.000Z');
    }
  });

  it('keeps the grid point the API used', () => {
    expect(parsed.gridLat).toBeCloseTo(42.6, 1);
    expect(parsed.gridLon).toBeCloseTo(-72.55, 1);
  });

  it('converts chance of rain from percent to a fraction and keeps other values in SI', () => {
    const body = copy(previousRuns()) as { hourly: Record<string, (number | null)[]> };
    const i = 10;
    const hour = parsed.byLead[1][i];
    expect(hour?.values.precipChance).toBeCloseTo(
      (body.hourly.precipitation_probability_previous_day1?.[i] as number) / 100,
    );
    expect(hour?.values.airTemp).toBe(body.hourly.temperature_2m_previous_day1?.[i]);
    expect(hour?.values.windSpeed).toBe(body.hourly.wind_speed_10m_previous_day1?.[i]);
    for (const h of parsed.byLead[2]) {
      const chance = h.values.precipChance;
      if (chance != null) expect(chance).toBeLessThanOrEqual(1);
      const direction = h.values.windDirection;
      if (direction != null) expect(direction).toBeLessThan(360);
    }
  });

  it('keeps a null value as null', () => {
    const body = copy(previousRuns()) as { hourly: Record<string, (number | null)[]> };
    (body.hourly.wind_gusts_10m_previous_day2 as (number | null)[])[3] = null;
    expect(parsePreviousRuns(body).byLead[2][3]?.values.windGust).toBeNull();
  });

  it('reports north as 0 degrees', () => {
    const body = copy(previousRuns()) as { hourly: Record<string, (number | null)[]> };
    (body.hourly.wind_direction_10m_previous_day1 as (number | null)[])[0] = 360;
    expect(parsePreviousRuns(body).byLead[1][0]?.values.windDirection).toBe(0);
  });

  it('rejects wind in another unit', () => {
    const body = copy(previousRuns()) as { hourly_units: Record<string, string> };
    body.hourly_units.wind_speed_10m_previous_day1 = 'km/h';
    expect(() => parsePreviousRuns(body)).toThrow(/km\/h, expected m\/s/);
  });

  it('rejects a missing variable', () => {
    const body = copy(previousRuns()) as { hourly: Record<string, unknown> };
    delete body.hourly.temperature_2m_previous_day2;
    expect(() => parsePreviousRuns(body)).toThrow(/temperature_2m_previous_day2 is missing/);
  });

  it('rejects a series shorter than the times', () => {
    const body = copy(previousRuns()) as { hourly: Record<string, unknown[]> };
    body.hourly.wind_gusts_10m_previous_day1 =
      body.hourly.wind_gusts_10m_previous_day1?.slice(1) ?? [];
    expect(() => parsePreviousRuns(body)).toThrow(/different length/);
  });

  it('rejects a response that is not Open-Meteo', () => {
    expect(() => parsePreviousRuns({ error: true, reason: 'bad' })).toThrow();
  });
});

describe('parseModeledHistory', () => {
  it('reads temperature and wind for every hour, with no chance of rain', () => {
    const parsed = parseModeledHistory(archive());
    expect(parsed.hours).toHaveLength(96);
    expect(parsed.hours[0]?.time).toBe('2026-05-14T00:00:00.000Z');
    expect(Object.keys(parsed.hours[0]?.values ?? {}).sort()).toEqual([
      'airTemp',
      'windDirection',
      'windGust',
      'windSpeed',
    ]);
  });
});

describe('parseAsos', () => {
  const reports = parseAsos(asos());

  it('reads every routine report in the window with the station position', () => {
    expect(reports).toHaveLength(96);
    expect(reports[0]).toMatchObject({
      station: 'ORE',
      time: '2026-05-14T00:52:00.000Z',
      lat: 42.5701,
      lon: -72.2886,
    });
  });

  it('converts knots to m/s', () => {
    const csv =
      'station,valid,lon,lat,tmpc,sknt,gust,drct\nORE,2026-05-14 00:52,-72.2886,42.5701,13.33,10.00,20.00,170.00\n';
    const [report] = parseAsos(csv);
    expect(report?.values.windSpeed).toBeCloseTo(5.144, 3);
    expect(report?.values.windGust).toBeCloseTo(10.289, 3);
    expect(report?.values.airTemp).toBe(13.33);
    expect(report?.values.windDirection).toBe(170);
  });

  it('treats a blank value as unknown, never zero', () => {
    const csv =
      'station,valid,lon,lat,tmpc,sknt,gust,drct\nORE,2026-05-14 00:52,-72.2886,42.5701,,,,\n';
    expect(parseAsos(csv)[0]?.values).toEqual({
      airTemp: null,
      windSpeed: null,
      windGust: null,
      windDirection: null,
    });
  });

  it('reports north as 0 degrees', () => {
    const csv =
      'station,valid,lon,lat,tmpc,sknt,gust,drct\nORE,2026-05-14 00:52,-72.2886,42.5701,10,5,,360\n';
    expect(parseAsos(csv)[0]?.values.windDirection).toBe(0);
  });

  it('rejects other columns, such as a request without latlon=yes', () => {
    expect(() => parseAsos('station,valid,tmpc,sknt,gust,drct\n')).toThrow(/unexpected columns/);
  });

  it('rejects a value that is not a number', () => {
    const csv =
      'station,valid,lon,lat,tmpc,sknt,gust,drct\nORE,2026-05-14 00:52,-72.2886,42.5701,M,5,,90\n';
    expect(() => parseAsos(csv)).toThrow(/row 1 did not parse/);
  });

  it('reads a CSV with only a header as no reports', () => {
    expect(parseAsos('station,valid,lon,lat,tmpc,sknt,gust,drct\n')).toEqual([]);
  });
});
