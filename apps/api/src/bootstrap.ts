import { Hono } from 'hono';
import { createNominatimAdapter } from './adapters/nominatim/nominatim.ts';
import { NOMINATIM_MIN_INTERVAL_MS } from './adapters/nominatim/requests.ts';
import { createNwpsAdapter } from './adapters/nwps/nwps.ts';
import { createNwsAdapter } from './adapters/nws/nws.ts';
import { createOverpassAdapter } from './adapters/overpass/overpass.ts';
import { createUsgsAdapter } from './adapters/usgs/usgs.ts';
import { createApp } from './app.ts';
import { type Config, loadConfig } from './config.ts';
import { type ConnectionOptions, createDatabase } from './db/client.ts';
import { getConditions } from './services/conditions.ts';
import { createCourseSnap } from './services/courseSnap.ts';
import { createErrorLog } from './services/errorLog.ts';
import { createPlaceSearch } from './services/places.ts';
import { createDatabaseGate } from './services/requestGate.ts';
import { createSourceCache } from './services/sourceCache.ts';

// Validates the environment and, if it's wrong, logs every problem by variable name before
// throwing. Each entry point then stops in its own way.
export function loadConfigOrReport(env: Record<string, string | undefined>): Config {
  try {
    return loadConfig(env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error('See .env.example for the variables the API needs.');
    throw error;
  }
}

// The API with its real adapters, cache, and database.
export function createApi(config: Config, connection: ConnectionOptions = {}) {
  const { db } = createDatabase(config.databaseUrl, connection);
  // Every warning the API logs is also recorded in error_events (decision 0018).
  const errorLog = createErrorLog({ db });
  const { logger } = errorLog;
  const usgs = createUsgsAdapter({
    logger,
    ...(config.usgsApiKey ? { apiKey: config.usgsApiKey } : {}),
  });
  const nwps = createNwpsAdapter({ logger });
  const nws = createNwsAdapter({ userAgent: config.nwsUserAgent, logger });
  const cache = createSourceCache({ db, logger });
  const now = () => new Date();

  // Nominatim asks for a User-Agent that identifies the app; NWS_USER_AGENT already does.
  const geocoder = createNominatimAdapter({
    userAgent: config.nwsUserAgent,
    logger,
    gate: createDatabaseGate({ db, name: 'nominatim', minIntervalMs: NOMINATIM_MIN_INTERVAL_MS }),
  });

  return createApp({
    usgs,
    conditions: (input) => getConditions(input, { usgs, nwps, nws, cache, now }),
    ...(config.geocodingEnabled ? { searchPlaces: createPlaceSearch({ geocoder, cache }) } : {}),
    // Overpass asks for a User-Agent that identifies the app; NWS_USER_AGENT already does.
    snapCourse: createCourseSnap({
      overpass: createOverpassAdapter({ userAgent: config.nwsUserAgent, logger }),
      cache,
    }),
    errorLog,
  });
}

// Neon's pooled connection (decision 0017). Prepared statements are off, which works with any
// transaction pooler. Each function instance keeps a few connections and closes idle ones, and
// connecting allows for Neon waking from suspend. Not yet measured against Neon (#34).
export const POOLED_CONNECTION: ConnectionOptions = {
  prepare: false,
  max: 5,
  idle_timeout: 20,
  connect_timeout: 15,
};

// The API as deployed on Vercel. Vercel passes /api/* to the API with the prefix kept, unlike
// the Vite dev proxy, which strips it, so the app is mounted under /api here.
export function createDeployedApp(env: Record<string, string | undefined>) {
  return new Hono().route('/api', createApi(loadConfigOrReport(env), POOLED_CONNECTION));
}
