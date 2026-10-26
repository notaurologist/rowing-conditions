import { describe, expect, it } from 'vitest';
import { formatDistanceKm, listMetrics } from './format.ts';

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
