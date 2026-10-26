import { zValidator } from '@hono/zod-validator';
import { GaugeRef } from '@rowing/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { SourceError } from './adapters/http.ts';
import type { FlowSource } from './adapters/types.ts';
import type { ConditionsInput, ConditionsResponse } from './services/conditions.ts';
import type { SearchPlaces } from './services/places.ts';

export interface AppDeps {
  usgs: FlowSource;
  conditions: (input: ConditionsInput) => Promise<ConditionsResponse>;
  searchPlaces?: SearchPlaces; // absent when place search is turned off (GEOCODING_ENABLED=false)
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

export const MAX_FLOW_GAUGES = 5;

const ConditionsQuery = z.object({
  lat: decimal(-90, 90),
  lon: decimal(-180, 180),
  gaugeRef: GaugeRef.optional(),
  // Comma-separated gauge refs named by rule sets, e.g. "nwps:MNTM3,usgs:USGS-01170500".
  flowGaugeRefs: z
    .string()
    .transform((v) => [
      ...new Set(
        v
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(GaugeRef).max(MAX_FLOW_GAUGES))
    .optional(),
});

const PlaceQuery = z.object({ q: z.string().trim().min(2).max(200) });

const upstreamError = (error: SourceError) => ({
  error: { source: error.source, kind: error.kind, message: error.message },
});

// Routes are chained so AppType carries every route for hono/client.
export function createApp(deps: AppDeps) {
  return (
    new Hono()
      .get('/health', (c) => c.json({ status: 'ok' }))

      // Always 200: each source's failure is reported in `sources`, never as a failed request.
      .get('/conditions', zValidator('query', ConditionsQuery), async (c) => {
        const { lat, lon, gaugeRef, flowGaugeRefs } = c.req.valid('query');
        const response = await deps.conditions({
          lat,
          lon,
          ...(gaugeRef ? { gaugeRef } : {}),
          ...(flowGaugeRefs?.length ? { flowGaugeRefs } : {}),
        });
        return c.json(response, 200);
      })

      // Search runs only when the user submits, never per keystroke: Nominatim forbids autocomplete.
      .get('/places/search', zValidator('query', PlaceQuery), async (c) => {
        if (!deps.searchPlaces) {
          return c.json(
            { error: { message: 'Place search is turned off. Pick the location on the map.' } },
            503,
          );
        }
        const result = await deps.searchPlaces(c.req.valid('query').q);
        if (!result.ok) return c.json(upstreamError(result.error), 502);
        return c.json({ places: result.data }, 200);
      })

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
          return c.json(
            { error: { message: `${source} gauges arrive with the NWPS adapter` } },
            501,
          );
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
      })
  );
}

export type AppType = ReturnType<typeof createApp>;
