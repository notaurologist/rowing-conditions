import type { Gauge, NearbyGauge, Reading } from '@rowing/core';
import { describe, expect, it, vi } from 'vitest';
import type { SourceResult } from './adapters/http.ts';
import type { FlowSource } from './adapters/types.ts';
import { createApp, DEFAULT_RADIUS_KM, MAX_RADIUS_KM } from './app.ts';

const montague: Gauge = {
  ref: 'usgs:USGS-01170500',
  source: 'usgs',
  name: 'CONNECTICUT RIVER AT MONTAGUE CITY, MA',
  lat: 42.58,
  lon: -72.57,
  metrics: ['flow', 'gaugeHeight'],
};
const nearby: NearbyGauge[] = [{ ...montague, distanceKm: 3.2 }];
const flow: Reading = {
  metric: 'flow',
  value: 143.28,
  observedAt: '2026-10-25T23:15:00.000Z',
  fetchedAt: '2026-10-25T23:30:00.000Z',
  source: 'usgs',
  sourceRef: 'USGS-01170500',
  qualifiers: ['provisional'],
};
const ok = <T>(data: T): SourceResult<T> => ({ ok: true, data });
const failed: SourceResult<never> = {
  ok: false,
  error: { source: 'usgs', kind: 'timeout', message: 'The operation timed out' },
};

function fakeUsgs(overrides: Partial<FlowSource> = {}): FlowSource {
  return {
    id: 'usgs',
    findNearby: vi.fn(async () => ok(nearby)),
    getGauge: vi.fn(async () => ok(montague)),
    getLatest: vi.fn(async () => ok([flow])),
    getHistory: vi.fn(async () => ok([])),
    ...overrides,
  };
}

const request = (path: string, usgs = fakeUsgs()) => createApp({ usgs }).request(path);

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('returns 404 for an unknown route', async () => {
    expect((await request('/nope')).status).toBe(404);
  });
});

describe('GET /gauges/nearby', () => {
  it('returns nearby gauges from the adapter', async () => {
    const usgs = fakeUsgs();
    const res = await request('/gauges/nearby?lat=42.6&lon=-72.55&radiusKm=15', usgs);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gauges: nearby });
    expect(usgs.findNearby).toHaveBeenCalledWith(42.6, -72.55, 15);
  });

  it('uses the default radius when none is given', async () => {
    const usgs = fakeUsgs();
    await request('/gauges/nearby?lat=42.6&lon=-72.55', usgs);
    expect(usgs.findNearby).toHaveBeenCalledWith(42.6, -72.55, DEFAULT_RADIUS_KM);
  });

  it.each([
    ['missing lat', '/gauges/nearby?lon=-72.55'],
    ['empty lat', '/gauges/nearby?lat=&lon=-72.55'],
    ['non-numeric lon', '/gauges/nearby?lat=42.6&lon=west'],
    ['lat out of range', '/gauges/nearby?lat=91&lon=-72.55'],
    ['lon out of range', '/gauges/nearby?lat=42.6&lon=-181'],
    ['radius too large', `/gauges/nearby?lat=42.6&lon=-72.55&radiusKm=${MAX_RADIUS_KM + 1}`],
    ['radius zero', '/gauges/nearby?lat=42.6&lon=-72.55&radiusKm=0'],
  ])('rejects %s with 400 and does not call the adapter', async (_, path) => {
    const usgs = fakeUsgs();
    expect((await request(path, usgs)).status).toBe(400);
    expect(usgs.findNearby).not.toHaveBeenCalled();
  });

  it('reports an upstream failure as 502 with the source and kind', async () => {
    const res = await request(
      '/gauges/nearby?lat=42.6&lon=-72.55',
      fakeUsgs({ findNearby: async () => failed }),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { source: 'usgs', kind: 'timeout', message: 'The operation timed out' },
    });
  });
});

describe('GET /gauges/:ref', () => {
  it('returns the gauge and its latest readings', async () => {
    const usgs = fakeUsgs();
    const res = await request('/gauges/usgs:USGS-01170500', usgs);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      gauge: montague,
      latest: [flow],
      sources: [{ id: 'usgs', status: 'ok' }],
    });
    expect(usgs.getGauge).toHaveBeenCalledWith('USGS-01170500');
  });

  it('accepts a URL-encoded ref', async () => {
    expect((await request('/gauges/usgs%3AUSGS-01170500')).status).toBe(200);
  });

  it('returns 404 for a gauge that does not exist', async () => {
    const res = await request(
      '/gauges/usgs:USGS-99999999',
      fakeUsgs({ getGauge: async () => ok(null) }),
    );
    expect(res.status).toBe(404);
  });

  it('rejects a ref without a known source prefix', async () => {
    expect((await request('/gauges/USGS-01170500')).status).toBe(400);
    expect((await request('/gauges/noaa:MNTM3')).status).toBe(400);
  });

  it('answers NWPS refs with 501 until that adapter exists', async () => {
    expect((await request('/gauges/nwps:MNTM3')).status).toBe(501);
  });

  it('returns 502 when the gauge lookup fails', async () => {
    const res = await request(
      '/gauges/usgs:USGS-01170500',
      fakeUsgs({ getGauge: async () => failed }),
    );
    expect(res.status).toBe(502);
  });

  it('still returns the gauge when only the readings fail, and says so', async () => {
    const res = await request(
      '/gauges/usgs:USGS-01170500',
      fakeUsgs({ getLatest: async () => failed }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      gauge: montague,
      latest: [],
      sources: [{ id: 'usgs', status: 'error', message: 'The operation timed out' }],
    });
  });
});
