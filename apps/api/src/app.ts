import { zValidator } from '@hono/zod-validator';
import { GaugeRef } from '@rowing/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { SourceError } from './adapters/http.ts';
import type { FlowSource } from './adapters/types.ts';

export interface AppDeps {
  usgs: FlowSource;
}

export const MAX_RADIUS_KM = 100;
export const DEFAULT_RADIUS_KM = 25;

// A decimal number in a query string. Rejects empty strings, which z.coerce would turn into 0.
const decimal = (min: number, max: number) =>
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/, 'Expected a decimal number')
    .transform(Number)
    .pipe(z.number().min(min).max(max));

const NearbyQuery = z.object({
  lat: decimal(-90, 90),
  lon: decimal(-180, 180),
  radiusKm: decimal(0.1, MAX_RADIUS_KM).optional(),
});

const upstreamError = (error: SourceError) => ({
  error: { source: error.source, kind: error.kind, message: error.message },
});

// Routes are chained so AppType carries every route for hono/client.
export function createApp(deps: AppDeps) {
  return new Hono()
    .get('/health', (c) => c.json({ status: 'ok' }))

    .get('/gauges/nearby', zValidator('query', NearbyQuery), async (c) => {
      const { lat, lon, radiusKm = DEFAULT_RADIUS_KM } = c.req.valid('query');
      const result = await deps.usgs.findNearby(lat, lon, radiusKm);
      if (!result.ok) return c.json(upstreamError(result.error), 502);
      return c.json({ gauges: result.data }, 200);
    })

    .get('/gauges/:ref', zValidator('param', z.object({ ref: GaugeRef })), async (c) => {
      const { ref } = c.req.valid('param');
      const separator = ref.indexOf(':');
      const source = ref.slice(0, separator);
      const id = ref.slice(separator + 1);
      if (source !== 'usgs') {
        return c.json({ error: { message: `${source} gauges arrive with the NWPS adapter` } }, 501);
      }

      const gauge = await deps.usgs.getGauge(id);
      if (!gauge.ok) return c.json(upstreamError(gauge.error), 502);
      if (gauge.data === null) return c.json({ error: { message: `No gauge ${ref}` } }, 404);

      // Partial success: metadata without readings is still useful, with the failure reported.
      const latest = await deps.usgs.getLatest(id);
      return c.json(
        {
          gauge: gauge.data,
          latest: latest.ok ? latest.data : [],
          sources: [
            latest.ok
              ? { id: 'usgs', status: 'ok' as const }
              : { id: 'usgs', status: 'error' as const, message: latest.error.message },
          ],
        },
        200,
      );
    });
}

export type AppType = ReturnType<typeof createApp>;
