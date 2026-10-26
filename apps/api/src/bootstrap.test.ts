import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeployedApp, loadConfigOrReport } from './bootstrap.ts';

const valid = {
  DATABASE_URL: 'postgres://rowing:secret-password@localhost:5432/rowing',
  NWS_USER_AGENT: 'rowing-conditions (dev@example.test)',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createDeployedApp', () => {
  it('serves the API under /api, as Vercel routes it', async () => {
    const app = createDeployedApp(valid);
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('does not serve the API without the /api prefix', async () => {
    const app = createDeployedApp(valid);
    expect((await app.request('/health')).status).toBe(404);
  });

  it('fails to start on an invalid environment, naming each problem without values', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => createDeployedApp({ DATABASE_URL: 'mysql://user:secret-password@db/x' })).toThrow(
      /DATABASE_URL[\s\S]*NWS_USER_AGENT/,
    );
    const logged = errors.mock.calls.flat().join('\n');
    expect(logged).toContain('DATABASE_URL');
    expect(logged).toContain('.env.example');
    expect(logged).not.toContain('secret-password');
  });
});

describe('loadConfigOrReport', () => {
  it('returns the config and logs nothing when the environment is valid', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(loadConfigOrReport(valid).databaseUrl).toBe(valid.DATABASE_URL);
    expect(errors).not.toHaveBeenCalled();
  });
});
