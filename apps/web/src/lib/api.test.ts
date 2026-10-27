import { createApp } from '@rowing/api';
import type { NearbyGauge } from '@rowing/core';
import { describe, expect, it, vi } from 'vitest';
import {
  apiErrorMessage,
  createApiClient,
  fetchConditions,
  fetchNearbyGauges,
  fetchPlaces,
} from './api.ts';

const gauge: NearbyGauge = {
  ref: 'usgs:USGS-01170500',
  source: 'usgs',
  name: 'Connecticut River at Montague City, MA',
  lat: 42.58,
  lon: -72.57,
  metrics: ['flow', 'gaugeHeight'],
  distanceKm: 2.1,
};

const conditions = {
  location: { lat: 42.6, lon: -72.55, timezone: 'America/New_York' },
  current: [],
  trends: [],
  forecast: [],
  flowSeries: [],
  daylight: [],
  alerts: [],
  sources: [],
};

// The real Hono app with fake adapters, so the client is checked against the actual routes.
function clientFor(deps: Partial<Parameters<typeof createApp>[0]> = {}) {
  const usgs = {
    id: 'usgs' as const,
    findNearby: vi.fn(async () => ({ ok: true as const, data: [gauge] })),
    getGauge: vi.fn(),
    getLatest: vi.fn(),
    getHistory: vi.fn(),
  };
  const app = createApp({
    usgs,
    conditions: vi.fn(async () => conditions),
    ...deps,
  });
  const client = createApiClient('http://api.test', {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
  });
  return { client, usgs };
}

describe('API client', () => {
  it('fetches nearby gauges with the query the route expects', async () => {
    const { client, usgs } = clientFor();
    await expect(fetchNearbyGauges(client, { lat: 42.6, lon: -72.55 })).resolves.toEqual([gauge]);
    expect(usgs.findNearby).toHaveBeenCalledWith(42.6, -72.55, 25);
  });

  it('passes the gauge to /conditions only when there is one', async () => {
    const getConditions = vi.fn(async () => conditions);
    const { client } = clientFor({ conditions: getConditions });

    await fetchConditions(client, { lat: 42.6, lon: -72.55 });
    await fetchConditions(client, { lat: 42.6, lon: -72.55, gaugeRef: 'usgs:USGS-01170500' });

    expect(getConditions).toHaveBeenNthCalledWith(1, { lat: 42.6, lon: -72.55 });
    expect(getConditions).toHaveBeenNthCalledWith(2, {
      lat: 42.6,
      lon: -72.55,
      gaugeRef: 'usgs:USGS-01170500',
    });
  });

  it('passes the gauges rule sets name for their flow limits', async () => {
    const getConditions = vi.fn(async () => conditions);
    const { client } = clientFor({ conditions: getConditions });

    await fetchConditions(client, { lat: 42.6, lon: -72.55, flowGaugeRefs: [] });
    await fetchConditions(client, {
      lat: 42.6,
      lon: -72.55,
      flowGaugeRefs: ['nwps:MNTM3', 'usgs:USGS-01170500'],
    });

    expect(getConditions).toHaveBeenNthCalledWith(1, { lat: 42.6, lon: -72.55 });
    expect(getConditions).toHaveBeenNthCalledWith(2, {
      lat: 42.6,
      lon: -72.55,
      flowGaugeRefs: ['nwps:MNTM3', 'usgs:USGS-01170500'],
    });
  });

  it('throws on an upstream failure, with the message the API sent', async () => {
    const { client, usgs } = clientFor();
    usgs.findNearby.mockResolvedValueOnce({
      ok: false,
      error: { source: 'usgs', kind: 'timeout', message: 'USGS timed out' },
    } as never);

    const error = await fetchNearbyGauges(client, { lat: 42.6, lon: -72.55 }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(apiErrorMessage(error)).toBe('USGS timed out');
  });

  it('throws on a rejected request rather than returning empty data', async () => {
    const { client } = clientFor();
    const error = await fetchNearbyGauges(client, { lat: 123, lon: 0 }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(apiErrorMessage(error)).toMatch(/400/);
  });

  it('searches places and shows the API message when search is off', async () => {
    const place = {
      name: 'Turners Falls',
      displayName: 'Turners Falls, MA',
      lat: 42.6,
      lon: -72.55,
    };
    const searchPlaces = vi.fn(async () => ({ ok: true as const, data: [place] }));
    const on = clientFor({ searchPlaces }).client;
    await expect(fetchPlaces(on, 'Turners Falls')).resolves.toEqual([place]);
    expect(searchPlaces).toHaveBeenCalledWith('Turners Falls');

    const off = clientFor().client;
    const error = await fetchPlaces(off, 'Turners Falls').catch((e) => e);
    expect(apiErrorMessage(error)).toBe(
      'Place search is turned off. Pick the location on the map.',
    );
  });

  it('describes a network failure', () => {
    expect(apiErrorMessage(new TypeError('Failed to fetch'))).toBe('Failed to fetch');
    expect(apiErrorMessage('odd')).toBe('Unknown error');
  });
});
