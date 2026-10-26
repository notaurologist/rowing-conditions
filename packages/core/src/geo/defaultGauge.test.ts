import { describe, expect, it } from 'vitest';
import type { Metric } from '../types/measurement.ts';
import { defaultGauge } from './defaultGauge.ts';

const gauge = (id: string, distanceKm: number, metrics: Metric[]) => ({
  ref: `usgs:USGS-${id}`,
  source: 'usgs' as const,
  name: `Gauge ${id}`,
  lat: 42,
  lon: -72,
  metrics,
  distanceKm,
});

describe('defaultGauge', () => {
  it('returns null when there are no gauges', () => {
    expect(defaultGauge([])).toBeNull();
  });

  it('picks the nearest gauge that reports flow', () => {
    const near = gauge('1', 1, ['gaugeHeight']);
    const flow = gauge('2', 5, ['flow', 'gaugeHeight']);
    const farFlow = gauge('3', 9, ['flow']);
    expect(defaultGauge([near, flow, farFlow])).toBe(flow);
  });

  it('does not rely on the input being sorted', () => {
    const far = gauge('1', 9, ['flow']);
    const near = gauge('2', 2, ['flow']);
    expect(defaultGauge([far, near])).toBe(near);
  });

  it('falls back to the nearest gauge reporting gauge height', () => {
    const temp = gauge('1', 1, ['waterTemp']);
    const height = gauge('2', 4, ['gaugeHeight']);
    expect(defaultGauge([temp, height])).toBe(height);
  });

  it('falls back to the nearest gauge reporting water temperature', () => {
    const temp = gauge('1', 3, ['waterTemp']);
    expect(defaultGauge([gauge('2', 1, []), temp])).toBe(temp);
  });

  it('returns null when no gauge reports flow, gauge height or water temperature', () => {
    expect(defaultGauge([gauge('1', 1, []), gauge('2', 2, ['airTemp'])])).toBeNull();
  });
});
