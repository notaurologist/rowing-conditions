import { serve } from '@hono/node-server';
import { consoleLogger } from './adapters/http.ts';
import { createNwpsAdapter } from './adapters/nwps/nwps.ts';
import { createNwsAdapter } from './adapters/nws/nws.ts';
import { createUsgsAdapter } from './adapters/usgs/usgs.ts';
import { createApp } from './app.ts';
import { type Config, loadConfig } from './config.ts';
import { createDatabase } from './db/client.ts';
import { getConditions } from './services/conditions.ts';
import { createSourceCache } from './services/sourceCache.ts';

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error('See .env.example for the variables the API needs.');
  process.exit(1);
}

const { db } = createDatabase(config.databaseUrl);
const usgs = createUsgsAdapter(config.usgsApiKey ? { apiKey: config.usgsApiKey } : {});
const nwps = createNwpsAdapter();
const nws = createNwsAdapter({ userAgent: config.nwsUserAgent });
const cache = createSourceCache({ db, logger: consoleLogger });
const now = () => new Date();

const app = createApp({
  usgs,
  conditions: (input) => getConditions(input, { usgs, nwps, nws, cache, now }),
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
