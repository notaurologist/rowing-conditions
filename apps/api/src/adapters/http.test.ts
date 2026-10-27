import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  describeError,
  describeShape,
  describeUrl,
  type FetchFn,
  fetchJson,
  type Logger,
} from './http.ts';

const schema = z.object({ value: z.number() });
const silent: Logger = { warn: vi.fn() };
const respond =
  (body: unknown, status = 200): FetchFn =>
  async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

const get = (fetch: FetchFn, logger: Logger = silent, timeoutMs?: number) =>
  fetchJson('https://example.test/x', schema, { source: 'usgs', fetch, logger, timeoutMs });

describe('fetchJson', () => {
  it('returns parsed data', async () => {
    expect(await get(respond({ value: 3 }))).toEqual({ ok: true, data: { value: 3 } });
  });

  it('reports a non-2xx status as an http error', async () => {
    expect(await get(respond({}, 503))).toEqual({
      ok: false,
      error: { source: 'usgs', kind: 'http', status: 503, message: 'HTTP 503' },
    });
  });

  it('reports invalid JSON as a parse error', async () => {
    const result = await get(respond('<html>'));
    expect(result).toMatchObject({ ok: false, error: { kind: 'parse' } });
  });

  it('reports a schema mismatch as a parse error and logs the payload shape, not its values', async () => {
    const logger: Logger = { warn: vi.fn() };
    const result = await get(respond({ value: 'secret-ish' }), logger);
    expect(result).toMatchObject({ ok: false, error: { kind: 'parse' } });
    const details = vi.mocked(logger.warn).mock.calls[0]?.[1];
    expect(details?.shape).toEqual({ value: 'string' });
    expect(JSON.stringify(details)).not.toContain('secret-ish');
  });

  it('logs a schema mismatch without the location in the request URL', async () => {
    const logger: Logger = { warn: vi.fn() };
    await fetchJson('https://api.weather.gov/points/42.5300,-72.5700', schema, {
      source: 'nws',
      fetch: respond({ value: 'x' }),
      logger,
    });
    const details = vi.mocked(logger.warn).mock.calls[0]?.[1];
    expect(details?.url).toBe('https://api.weather.gov/points/:point');
    expect(JSON.stringify(details)).not.toContain('42.53');
  });

  it('reports a thrown fetch as a network error', async () => {
    const fetch: FetchFn = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await get(fetch)).toMatchObject({ ok: false, error: { kind: 'network' } });
  });

  it('times out a slow request', async () => {
    const fetch: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    expect(await get(fetch, silent, 20)).toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });

  it('sends extra headers', async () => {
    const fetch = vi.fn(respond({ value: 1 }));
    await fetchJson('https://example.test/x', schema, {
      source: 'usgs',
      fetch,
      logger: silent,
      headers: { 'X-Api-Key': 'k' },
    });
    const headers = fetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBe('k');
  });
});

describe('describeUrl', () => {
  it('replaces coordinate pairs in the path', () => {
    expect(describeUrl('https://api.weather.gov/points/42.5300,-72.5700')).toBe(
      'https://api.weather.gov/points/:point',
    );
    expect(describeUrl('https://api.weather.gov/gridpoints/BOX/71,90/forecast')).toBe(
      'https://api.weather.gov/gridpoints/BOX/:point/forecast',
    );
  });

  it('keeps query names and drops their values', () => {
    expect(describeUrl('https://api.weather.gov/alerts/active?point=42.53,-72.57')).toBe(
      'https://api.weather.gov/alerts/active?point',
    );
    expect(
      describeUrl('https://nominatim.openstreetmap.org/search?q=turners+falls&format=jsonv2'),
    ).toBe('https://nominatim.openstreetmap.org/search?q&format');
  });

  it('describes an unparseable URL without echoing it', () => {
    expect(describeUrl('not a url 42.53,-72.57')).toBe('invalid URL');
  });
});

describe('describeError', () => {
  it("uses the driver's error for a failed Drizzle query, not the query's parameters", () => {
    const error = new DrizzleQueryError(
      'select * from "source_cache" where "key" = $1',
      ['nws:point:42.5300,-72.5700'],
      new Error('connection terminated'),
    );
    expect(describeError(error)).toBe('connection terminated');
  });

  it('uses the message of any other error', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('plain')).toBe('plain');
  });
});

describe('describeShape', () => {
  it('keeps keys and types, drops values', () => {
    expect(describeShape({ a: 1, b: ['x', 'y'], c: null })).toEqual({
      a: 'number',
      b: [2, 'string'],
      c: 'null',
    });
  });
});
