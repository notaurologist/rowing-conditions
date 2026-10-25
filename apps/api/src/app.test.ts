import { describe, expect, it } from 'vitest';
import { app } from './app.ts';

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await app.request('/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('returns 404 for an unknown route', async () => {
    const res = await app.request('/nope');

    expect(res.status).toBe(404);
  });
});
