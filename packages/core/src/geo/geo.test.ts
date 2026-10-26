import { describe, expect, it } from 'vitest';
import { boundingBox, distanceKm } from './geo.ts';

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(42.6, -72.55, 42.6, -72.55)).toBe(0);
  });

  it('matches known distances', () => {
    // One degree of latitude is about 111.2 km.
    expect(distanceKm(42, -72, 43, -72)).toBeCloseTo(111.2, 0);
    // Montague City gauge to the gauge near Northfield, MA: about 14.2 km.
    expect(distanceKm(42.5802, -72.5745, 42.6833, -72.4719)).toBeCloseTo(14.2, 0);
    // Boston to New York: about 306 km.
    expect(distanceKm(42.3601, -71.0589, 40.7128, -74.006)).toBeCloseTo(306, -1);
  });

  it('is symmetric', () => {
    expect(distanceKm(42.6, -72.55, 40.7, -74)).toBeCloseTo(distanceKm(40.7, -74, 42.6, -72.55), 9);
  });
});

describe('boundingBox', () => {
  it('contains points at the radius in every direction', () => {
    const [minLon, minLat, maxLon, maxLat] = boundingBox(42.6, -72.55, 20);
    for (const [lat, lon] of [
      [42.6 + 20 / 111.2, -72.55],
      [42.6 - 20 / 111.2, -72.55],
      [42.6, -72.55 + 20 / (111.2 * Math.cos((42.6 * Math.PI) / 180))],
      [42.6, -72.55 - 20 / (111.2 * Math.cos((42.6 * Math.PI) / 180))],
    ] as const) {
      expect(lat).toBeGreaterThanOrEqual(minLat);
      expect(lat).toBeLessThanOrEqual(maxLat);
      expect(lon).toBeGreaterThanOrEqual(minLon);
      expect(lon).toBeLessThanOrEqual(maxLon);
    }
  });

  it('stays within valid coordinates', () => {
    const box = boundingBox(89.9, 179.9, 100);
    expect(box[2]).toBeLessThanOrEqual(180);
    expect(box[3]).toBeLessThanOrEqual(90);
  });
});
