import { describe, expect, it } from 'vitest';
import {
  compassPoint,
  formatAge,
  formatDistanceKm,
  formatNumber,
  formatTime,
  listMetrics,
  tidyGaugeName,
} from './format.ts';

describe('listMetrics', () => {
  it('joins metric names in plain words', () => {
    expect(listMetrics([])).toBe('');
    expect(listMetrics(['flow'])).toBe('flow');
    expect(listMetrics(['flow', 'waterTemp'])).toBe('flow and water temperature');
    expect(listMetrics(['flow', 'gaugeHeight', 'waterTemp'])).toBe(
      'flow, gauge height and water temperature',
    );
  });

  it('lists metrics in a fixed order, whatever order the source gave', () => {
    expect(listMetrics(['waterTemp', 'flow', 'gaugeHeight'])).toBe(
      'flow, gauge height and water temperature',
    );
  });
});

describe('formatDistanceKm', () => {
  it('shows miles for US units and kilometres for metric', () => {
    expect(formatDistanceKm(1.609344, 'us')).toBe('1.0 mi');
    expect(formatDistanceKm(3.25, 'metric')).toBe('3.3 km');
  });
});

describe('formatNumber', () => {
  it('uses the unit precision with separators', () => {
    expect(formatNumber(5060, 'cfs')).toBe('5,060');
    expect(formatNumber(143.3, 'm3/s')).toBe('143.3');
    expect(formatNumber(12.2, 'ft')).toBe('12.20');
    expect(formatNumber(-0.5, 'degC')).toBe('-0.5');
  });
});

describe('compassPoint', () => {
  it.each([
    [0, 'N'],
    [11, 'N'],
    [12, 'NNE'],
    [90, 'E'],
    [200, 'SSW'],
    [315, 'NW'],
    [349, 'N'],
    [359.9, 'N'],
  ])('%s° is %s', (degrees, point) => {
    expect(compassPoint(degrees)).toBe(point);
  });
});

describe('formatAge', () => {
  const now = '2026-10-26T12:00:00.000Z';
  it.each([
    ['2026-10-26T11:59:40.000Z', 'just now'],
    ['2026-10-26T11:35:00.000Z', '25 min ago'],
    ['2026-10-26T11:00:00.000Z', '1 h ago'],
    ['2026-10-26T08:55:00.000Z', '3 h 5 min ago'],
    ['2026-10-24T10:00:00.000Z', '2 days ago'],
    ['2026-10-26T12:30:00.000Z', 'in 30 min'],
    ['2026-10-26T15:00:00.000Z', 'in 3 h'],
  ])('%s is %s', (time, text) => {
    expect(formatAge(time, now)).toBe(text);
  });
});

describe('formatTime', () => {
  it('shows the clock time in the location time zone, with the date when not today', () => {
    const now = '2026-10-26T16:00:00.000Z'; // noon in New York
    expect(formatTime('2026-10-26T13:15:00.000Z', now, 'America/New_York')).toBe('9:15 AM');
    expect(formatTime('2026-10-26T02:00:00.000Z', now, 'America/New_York')).toBe(
      'Oct 25, 10:00 PM',
    );
  });
});

describe('tidyGaugeName', () => {
  it('turns USGS capitals into a readable name', () => {
    expect(tidyGaugeName('CONNECTICUT RIVER AT MONTAGUE CITY, MA')).toBe(
      'Connecticut River at Montague City, MA',
    );
    expect(tidyGaugeName('FARMINGTON R AT RAINBOW, CT.')).toBe('Farmington R at Rainbow, CT');
    expect(tidyGaugeName('McDowell Creek at Oak, NC')).toBe('McDowell Creek at Oak, NC');
  });
});
