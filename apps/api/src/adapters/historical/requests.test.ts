import { describe, expect, it } from 'vitest';
import { archiveUrl, asosUrl, iemStationId, previousRunsUrl } from './requests.ts';

const params = (url: string) => new URL(url).searchParams;

describe('historical weather request URLs', () => {
  it('asks the Previous Runs API for every metric a day and two days ahead, in SI and UTC', () => {
    const url = previousRunsUrl(42.6, -72.55, '2026-05-14', '2026-05-17');
    expect(url.startsWith('https://previous-runs-api.open-meteo.com/v1/forecast?')).toBe(true);
    const p = params(url);
    expect(p.get('hourly')?.split(',')).toEqual([
      'temperature_2m_previous_day1',
      'temperature_2m_previous_day2',
      'wind_speed_10m_previous_day1',
      'wind_speed_10m_previous_day2',
      'wind_gusts_10m_previous_day1',
      'wind_gusts_10m_previous_day2',
      'wind_direction_10m_previous_day1',
      'wind_direction_10m_previous_day2',
      'precipitation_probability_previous_day1',
      'precipitation_probability_previous_day2',
    ]);
    expect(p.get('models')).toBe('ncep_nbm_conus');
    expect(p.get('wind_speed_unit')).toBe('ms');
    expect(p.get('timezone')).toBe('GMT');
  });

  it('asks the archive for observed-style variables without a model or lead time', () => {
    const p = params(archiveUrl(42.6, -72.55, '2026-05-14', '2026-05-17'));
    expect(p.get('hourly')).toBe('temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m');
    expect(p.has('models')).toBe(false);
    expect(p.get('wind_speed_unit')).toBe('ms');
  });

  it('repeats data= for each IEM field and asks for routine reports as CSV in UTC', () => {
    const p = params(asosUrl('KORE', '2026-05-14', '2026-05-18'));
    expect(p.getAll('data')).toEqual(['tmpc', 'sknt', 'gust', 'drct']);
    expect(p.get('format')).toBe('onlycomma');
    expect(p.get('missing')).toBe('empty');
    expect(p.get('report_type')).toBe('3');
  });

  it.each([
    ['KORE', 'ORE'],
    ['kore', 'ORE'],
    ['ORE', 'ORE'],
    ['PAFA', 'PAFA'], // Alaska keeps its P
    ['K1B9', '1B9'],
  ])('maps station %s to IEM ID %s', (input, expected) => {
    expect(iemStationId(input)).toBe(expected);
  });
});
