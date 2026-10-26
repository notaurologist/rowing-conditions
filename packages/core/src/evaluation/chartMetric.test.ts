import { describe, expect, it } from 'vitest';
import type { ForecastPoint } from '../types/readings.ts';
import { availableChartMetrics, chartMetricOf, defaultChartMetric } from './chartMetric.ts';

const point = (values: ForecastPoint['values']): ForecastPoint => ({
  time: '2026-10-26T12:00:00.000Z',
  values,
  provenance: Object.fromEntries(
    Object.keys(values).map((m) => [
      m,
      { kind: 'forecast', asOf: '2026-10-26T10:00:00.000Z', source: 'nws' },
    ]),
  ),
});

describe('chartMetricOf', () => {
  it('groups wind speed and gusts into one chart, and has none for direction', () => {
    expect(chartMetricOf('windSpeed')).toBe('wind');
    expect(chartMetricOf('windGust')).toBe('wind');
    expect(chartMetricOf('windDirection')).toBeNull();
    expect(chartMetricOf('flow')).toBe('flow');
    expect(chartMetricOf('combinedTempF')).toBe('combinedTempF');
  });
});

describe('availableChartMetrics', () => {
  it('lists metrics with a value in some hour, in a fixed order', () => {
    const forecast = [
      point({ airTemp: 3, windSpeed: 2, flow: null }),
      point({ airTemp: null, windGust: 5, waterTemp: 11, precipChance: 0.1 }),
    ];
    expect(availableChartMetrics(forecast)).toEqual([
      'wind',
      'waterTemp',
      'airTemp',
      'precipChance',
    ]);
  });

  it('offers combined temperature only when some hour has both parts', () => {
    expect(availableChartMetrics([point({ airTemp: 3 }), point({ waterTemp: 11 })])).toEqual([
      'waterTemp',
      'airTemp',
    ]);
  });

  it('leaves out a metric that is null in every hour', () => {
    expect(availableChartMetrics([point({ flow: null, gaugeHeight: 2 })])).toEqual(['gaugeHeight']);
  });
});

describe('defaultChartMetric', () => {
  const available = ['flow', 'wind', 'airTemp'] as const;

  it('uses the pinned metric when it has data', () => {
    expect(
      defaultChartMetric({
        available,
        pinned: 'airTemp',
        limiting: { metric: 'windGust', reason: 'mostHoursOutside', hoursOutside: 4, headroom: -1 },
      }),
    ).toEqual({ metric: 'airTemp', reason: 'pinned' });
  });

  it('ignores a pinned metric with no data here', () => {
    expect(defaultChartMetric({ available, pinned: 'waterTemp', limiting: null })).toEqual({
      metric: 'flow',
      reason: 'fallback',
    });
  });

  it('follows the limiting factor, with its reason', () => {
    expect(
      defaultChartMetric({
        available,
        limiting: { metric: 'windGust', reason: 'mostHoursOutside', hoursOutside: 4, headroom: -1 },
      }),
    ).toEqual({ metric: 'wind', reason: 'mostHoursOutside', hoursOutside: 4 });
    expect(
      defaultChartMetric({
        available,
        limiting: { metric: 'airTemp', reason: 'leastHeadroom', hoursOutside: 0, headroom: 0.2 },
      }),
    ).toEqual({ metric: 'airTemp', reason: 'leastHeadroom', hoursOutside: 0 });
  });

  it('falls back to flow, then wind, then the first metric with data', () => {
    expect(defaultChartMetric({ available, limiting: null })).toEqual({
      metric: 'flow',
      reason: 'fallback',
    });
    expect(defaultChartMetric({ available: ['airTemp', 'wind'], limiting: null })).toEqual({
      metric: 'wind',
      reason: 'fallback',
    });
    expect(defaultChartMetric({ available: ['airTemp'], limiting: null })).toEqual({
      metric: 'airTemp',
      reason: 'fallback',
    });
  });

  it('returns null when nothing has data', () => {
    expect(defaultChartMetric({ available: [], limiting: null })).toBeNull();
  });
});
