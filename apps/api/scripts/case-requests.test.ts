import { describe, expect, it } from 'vitest';
import { caseRequests, caseWindow, isEmptyRecording, parseCaseArgs } from './case-requests.ts';

const today = new Date('2026-10-26T12:00:00Z');
const base = ['--name', 'may-15', '--date', '2026-05-15', '--lat', '42.6', '--lon', '-72.55'];
const withGauge = [...base, '--gauge', 'USGS-01170500'];
const params = (url: string | undefined) => Object.fromEntries(new URL(url ?? '').searchParams);

describe('parseCaseArgs', () => {
  it('reads a full case', () => {
    expect(
      parseCaseArgs([...withGauge, '--gauge', 'USGS-01161280', '--station', 'kore'], today),
    ).toEqual({
      name: 'may-15',
      date: '2026-05-15',
      lat: 42.6,
      lon: -72.55,
      gauges: ['USGS-01170500', 'USGS-01161280'],
      station: 'KORE',
    });
  });

  it('reads negative coordinates given as a separate argument or with =', () => {
    const southWest = [
      ...withGauge.slice(0, 4),
      '--lat',
      '-33.9',
      '--lon=-70.6',
      ...withGauge.slice(8),
    ];
    expect(parseCaseArgs(southWest, today)).toMatchObject({ lat: -33.9, lon: -70.6 });
  });

  it('leaves the station out when none is given', () => {
    expect(parseCaseArgs(withGauge, today)).not.toHaveProperty('station');
  });

  it.each([
    ['a missing name', withGauge.slice(2), /--name is required/],
    ['a name that is not kebab-case', ['--name', 'May 15', ...withGauge.slice(2)], /kebab-case/],
    ['a missing date', [...withGauge.slice(0, 2), ...withGauge.slice(4)], /--date is required/],
    ['a badly formatted date', withGauge.with(3, '15/05/2026'), /YYYY-MM-DD/],
    ['a date that does not exist', withGauge.with(3, '2026-02-30'), /not a real date/],
    ['a date before the forecast archive', withGauge.with(3, '2023-12-31'), /2024-01-01/],
    ['a date whose window is not over', withGauge.with(3, '2026-10-24'), /three days ago/],
    ['a missing latitude', [...withGauge.slice(0, 4), ...withGauge.slice(6)], /--lat/],
    ['a latitude out of range', withGauge.with(5, '91'), /--lat is out of range/],
    ['a longitude that is not a number', withGauge.with(7, 'west'), /--lon is out of range/],
    ['no gauge', base, /--gauge is required/],
    ['a gauge without the USGS prefix', [...base, '--gauge', '01170500'], /USGS-01170500/],
    ['a station that is not an identifier', [...withGauge, '--station', 'Orange'], /airport/],
    ['an unknown option', [...withGauge, '--hours', '48'], /Unknown option/],
  ])('rejects %s with the usage line', (_, args, message) => {
    expect(() => parseCaseArgs(args, today)).toThrow(message);
    expect(() => parseCaseArgs(args, today)).toThrow(/Usage: pnpm fixtures:record-case/);
  });

  it('accepts the latest date whose window is over', () => {
    expect(parseCaseArgs(withGauge.with(3, '2026-10-23'), today).date).toBe('2026-10-23');
  });
});

describe('caseWindow', () => {
  it('runs from the day before through two days after, across month ends', () => {
    expect(caseWindow('2026-05-15')).toEqual({ start: '2026-05-14', endExclusive: '2026-05-18' });
    expect(caseWindow('2026-03-01')).toEqual({ start: '2026-02-28', endExclusive: '2026-03-04' });
  });
});

describe('caseRequests', () => {
  const backtestCase = parseCaseArgs(
    [...withGauge, '--gauge', 'USGS-01161280', '--station', 'KORE'],
    today,
  );
  const requests = caseRequests(backtestCase);

  it('records each gauge metric, the forecast, and the station into the case folder', () => {
    expect(Object.keys(requests).sort()).toEqual([
      'cases/may-15/iem-asos-ore',
      'cases/may-15/open-meteo-previous-runs',
      'cases/may-15/usgs-01161280-flow',
      'cases/may-15/usgs-01161280-gauge-height',
      'cases/may-15/usgs-01161280-water-temp',
      'cases/may-15/usgs-01170500-flow',
      'cases/may-15/usgs-01170500-gauge-height',
      'cases/may-15/usgs-01170500-water-temp',
    ]);
  });

  it('asks USGS continuous data for the whole window in UTC', () => {
    const url = requests['cases/may-15/usgs-01170500-gauge-height'];
    expect(url).toContain('/collections/continuous/items');
    expect(params(url)).toMatchObject({
      monitoring_location_id: 'USGS-01170500',
      parameter_code: '00065',
      time: '2026-05-14T00:00:00Z/2026-05-18T00:00:00Z',
    });
  });

  it('asks for forecasts a day and two days ahead over the same days', () => {
    const p = params(requests['cases/may-15/open-meteo-previous-runs']);
    expect(p).toMatchObject({
      latitude: '42.6',
      longitude: '-72.55',
      start_date: '2026-05-14',
      end_date: '2026-05-17',
      models: 'ncep_nbm_conus',
      wind_speed_unit: 'ms',
      timezone: 'GMT',
    });
    expect(p.hourly?.split(',')).toEqual(
      expect.arrayContaining([
        'temperature_2m_previous_day1',
        'wind_gusts_10m_previous_day2',
        'precipitation_probability_previous_day1',
      ]),
    );
  });

  it('asks IEM for the station without its K, with an exclusive end date', () => {
    const p = params(requests['cases/may-15/iem-asos-ore']);
    expect(p).toMatchObject({
      station: 'ORE',
      year1: '2026',
      month1: '5',
      day1: '14',
      year2: '2026',
      month2: '5',
      day2: '18',
      tz: 'Etc/UTC',
      report_type: '3',
    });
  });

  it('records modeled history instead when there is no station', () => {
    const noStation = caseRequests(parseCaseArgs(withGauge, today));
    expect(Object.keys(noStation)).toContain('cases/may-15/open-meteo-archive');
    expect(Object.keys(noStation).some((n) => n.includes('iem'))).toBe(false);
    expect(params(noStation['cases/may-15/open-meteo-archive'])).toMatchObject({
      start_date: '2026-05-14',
      end_date: '2026-05-17',
    });
  });
});

describe('isEmptyRecording', () => {
  it.each([
    ['a USGS response with no features', { type: 'FeatureCollection', features: [] }, true],
    ['a USGS response with features', { features: [{ properties: {} }] }, false],
    ['IEM CSV with only its header', 'station,valid,tmpc,sknt,gust,drct\n', true],
    ['IEM CSV with a row', 'station,valid,tmpc\nORE,2026-05-14 00:52,13.33\n', false],
    ['an Open-Meteo response', { hourly: { time: [] } }, false],
  ])('treats %s as empty: %s', (_, body, expected) => {
    expect(isEmptyRecording(body)).toBe(expected);
  });
});
