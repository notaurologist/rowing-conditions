import { Hono } from 'hono';

// Routes are chained so AppType carries every route for hono/client.
export const app = new Hono().get('/health', (c) => c.json({ status: 'ok' }));

export type AppType = typeof app;
