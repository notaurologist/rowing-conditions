import { serve } from '@hono/node-server';
import { app } from './app.ts';

// Startup validation of all env config arrives with M4 (issue #23).
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
