import { serve } from '@hono/node-server';
import { createApi, loadConfigOrReport } from './bootstrap.ts';
import type { Config } from './config.ts';

// Local development and any plain Node host. Vercel uses vercel.ts instead.
let config: Config;
try {
  config = loadConfigOrReport(process.env);
} catch {
  process.exit(1);
}

const app = createApi(config);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
