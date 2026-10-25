import { serve } from '@hono/node-server';
import { createUsgsAdapter } from './adapters/usgs/usgs.ts';
import { createApp } from './app.ts';

// Startup validation of all env config arrives with M4 (issue #23).
const port = Number(process.env.PORT ?? 3000);
const usgsApiKey = process.env.USGS_API_KEY;

const app = createApp({
  usgs: createUsgsAdapter(usgsApiKey ? { apiKey: usgsApiKey } : {}),
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
