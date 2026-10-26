import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const valid = {
  DATABASE_URL: 'postgres://rowing:rowing@localhost:5432/rowing',
  NWS_USER_AGENT: 'rowing-conditions (dev@example.test)',
};

describe('loadConfig', () => {
  it('reads required values and defaults the port', () => {
    expect(loadConfig(valid)).toEqual({
      databaseUrl: valid.DATABASE_URL,
      nwsUserAgent: valid.NWS_USER_AGENT,
      port: 3000,
    });
  });

  it('reads an optional USGS key and a port', () => {
    expect(loadConfig({ ...valid, USGS_API_KEY: 'abc123', PORT: '8080' })).toMatchObject({
      usgsApiKey: 'abc123',
      port: 8080,
    });
  });

  it('treats an empty USGS key as no key, since USGS rejects invalid keys', () => {
    expect(loadConfig({ ...valid, USGS_API_KEY: '' })).not.toHaveProperty('usgsApiKey');
  });

  it('reports every problem at once, by variable name', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(
      /DATABASE_URL[\s\S]*NWS_USER_AGENT[\s\S]*PORT/,
    );
  });

  it.each([
    ['a non-Postgres DATABASE_URL', { ...valid, DATABASE_URL: 'mysql://localhost/db' }],
    ['a blank NWS_USER_AGENT', { ...valid, NWS_USER_AGENT: '   ' }],
    ['a port out of range', { ...valid, PORT: '70000' }],
  ])('rejects %s', (_, env) => {
    expect(() => loadConfig(env)).toThrow();
  });

  it('does not echo secret values in errors', () => {
    try {
      loadConfig({ ...valid, DATABASE_URL: 'mysql://user:hunter2@host/db' });
      throw new Error('expected loadConfig to throw');
    } catch (error) {
      expect(String(error)).not.toContain('hunter2');
    }
  });
});
