import { describe, expect, it } from 'vitest';
import { SavedLocation } from './location.ts';

const location = {
  id: 'loc-1',
  name: 'Turners Falls',
  lat: 42.6,
  lon: -72.55,
  gaugeRef: 'usgs:USGS-01170500',
  ruleSetIds: ['rs-club-a'],
};

describe('SavedLocation', () => {
  it('accepts a location with a gauge and rule sets', () => {
    expect(SavedLocation.safeParse(location).success).toBe(true);
  });

  it('accepts a weather-only location with no gauge or rule sets', () => {
    const { gaugeRef: _, ...weatherOnly } = location;
    expect(SavedLocation.safeParse({ ...weatherOnly, ruleSetIds: [] }).success).toBe(true);
  });

  it('rejects coordinates out of range', () => {
    expect(SavedLocation.safeParse({ ...location, lat: 91 }).success).toBe(false);
    expect(SavedLocation.safeParse({ ...location, lon: -181 }).success).toBe(false);
  });

  it('rejects a gauge ref without a known source prefix', () => {
    expect(SavedLocation.safeParse({ ...location, gaugeRef: 'USGS-01170500' }).success).toBe(false);
  });
});
