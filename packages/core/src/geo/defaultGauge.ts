import type { NearbyGauge } from '../types/gauge.ts';
import type { Metric } from '../types/measurement.ts';

// In order of preference: a flow gauge first, since most club limits are on flow.
const PREFERRED_METRICS: Metric[] = ['flow', 'gaugeHeight', 'waterTemp'];

/**
 * The gauge to suggest for a new location: the nearest that reports flow, else the nearest
 * reporting gauge height, else water temperature. Null means weather-only. The user can
 * always pick another, since the nearest gauge isn't always the relevant one.
 */
export function defaultGauge<T extends NearbyGauge>(gauges: readonly T[]): T | null {
  const byDistance = [...gauges].sort((a, b) => a.distanceKm - b.distanceKm);
  for (const metric of PREFERRED_METRICS) {
    const found = byDistance.find((g) => g.metrics.includes(metric));
    if (found) return found;
  }
  return null;
}
