import { zValidator } from '@hono/zod-validator';
import { type ConditionsResponse, GaugeRef } from '@rowing/core';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { SourceError } from './adapters/http.ts';
import type { FlowSource } from './adapters/types.ts';
import type { ConditionsInput } from './services/conditions.ts';
import type { SnapCourse } from './services/courseSnap.ts';
import type { ErrorLog } from './services/errorLog.ts';
import type { SearchPlaces } from './services/places.ts';

export interface AppDeps {
  usgs: FlowSource;
  conditions: (input: ConditionsInput) => Promise<ConditionsResponse>;
  searchPlaces?: SearchPlaces; // absent when place search is turned off (GEOCODING_ENABLED=false)
  snapCourse?: SnapCourse; // absent in tests that don't need it
  errorLog?: Pick<ErrorLog, 'record' | 'flush'>; // absent in tests that don't need it
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

const SnapQuery = z.object({
  startLat: decimal(-90, 90),
  startLon: decimal(-180, 180),
  turnLat: decimal(-90, 90),
  turnLon: decimal(-180, 180),
});

// Why a course couldn't follow the river, in words the app shows as they are.
const SNAP_PROBLEMS = {
  tooFar: 'The start and the turn are more than 30 km apart.',
  noRiver:
    'There is no mapped river within 300 m of the start or the turn. Tap closer to the river.',
  notConnected:
    "The start and the turn aren't on the same mapped river. Pick both on the water you row.",
} as const;

const upstreamError = (error: SourceError) => ({
  error: { source: error.source, kind: error.kind, message: error.message },
});

// Routes are chained so AppType carries every route for hono/client.
export function createApp(deps: AppDeps) {
  return (
    new Hono()
      // Unhandled exceptions are recorded (decision 0018) with the route pattern, never the
      // request's path or query, which can hold a location. The response says nothing more.
      .onError((error, c) => {
        if (error instanceof HTTPException) return error.getResponse();
        deps.errorLog?.record({
          level: 'error',
          message: 'unhandled exception',
          route: c.req.routePath,
          details: { name: error.name, message: error.message, stack: error.stack },
        });
        return c.json({ error: { message: 'Something went wrong on the server.' } }, 500);
      })
      // Recorded events are written before the response goes out, so a function instance isn't
      // frozen with writes pending.
      .use(async (_c, next) => {
        await next();
        await deps.errorLog?.flush();
      })

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

      // A course following the river between the tapped start and turn (#103).
      .get('/course/snap', zValidator('query', SnapQuery), async (c) => {
        if (!deps.snapCourse) {
          return c.json({ error: { message: 'Course snapping is turned off.' } }, 503);
        }
        const { startLat, startLon, turnLat, turnLon } = c.req.valid('query');
        const result = await deps.snapCourse([startLat, startLon], [turnLat, turnLon]);
        if (result.ok) return c.json({ points: result.points }, 200);
        if (result.reason === 'sourceError') {
          const { error } = upstreamError(result.error);
          // The public Overpass server is often busy for a few minutes.
          return c.json(
            {
              error: {
                ...error,
                message:
                  "OpenStreetMap's river data is busy right now. Try again in a few minutes.",
              },
            },
            502,
          );
        }
        return c.json(
          { error: { kind: result.reason, message: SNAP_PROBLEMS[result.reason] } },
          422,
        );
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
