import { describe, expect, it } from 'vitest';
import { newId, newLocation } from './newLocation.ts';

describe('newLocation', () => {
  it('builds a valid location with the chosen gauge and no rule sets', () => {
    const location = newLocation({
      name: '  Home boathouse ',
      lat: 42.6012345678,
      lon: -72.5500049,
      gaugeRef: 'usgs:USGS-01170500',
    });
    expect(location).toEqual({
      id: expect.any(String),
      name: 'Home boathouse',
      lat: 42.60123,
      lon: -72.55,
      gaugeRef: 'usgs:USGS-01170500',
      ruleSetIds: [],
    });
  });

  it('omits the gauge for weather-only', () => {
    const location = newLocation({ name: 'Lake', lat: 42, lon: -72, gaugeRef: null });
    expect(location).not.toHaveProperty('gaugeRef');
  });

  it('rejects an empty name', () => {
    expect(() => newLocation({ name: '  ', lat: 42, lon: -72, gaugeRef: null })).toThrow();
  });

  it('gives each location a different id', () => {
    expect(newId()).not.toBe(newId());
  });
});
