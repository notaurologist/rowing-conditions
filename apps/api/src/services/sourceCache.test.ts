import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createTestDatabase, createUnresponsiveDatabase } from '../../test/database.ts';
import type { Logger, SourceError, SourceResult } from '../adapters/http.ts';
import type { Database } from '../db/client.ts';
import { sourceCache as table } from '../db/schema.ts';
import { cacheTtlMs, createSourceCache } from './sourceCache.ts';

const MINUTE = 60_000;
const Payload = z.object({ flow: z.number() });
type Payload = z.infer<typeof Payload>;

const failure: SourceError = { source: 'usgs', kind: 'timeout', message: 'timed out' };
const ok = (data: Payload): SourceResult<Payload> => ({ ok: true, data });
const failed: SourceResult<Payload> = { ok: false, error: failure };

let db: Database;
let close: () => Promise<void>;
let clock: Date;
let warn: ReturnType<typeof vi.fn<Logger['warn']>>;

beforeEach(async () => {
  ({ db, close } = await createTestDatabase());
  clock = new Date('2026-10-26T12:00:00.000Z');
  warn = vi.fn<Logger['warn']>();
});
afterEach(async () => {
  await close();
});

const cache = () => createSourceCache({ db, logger: { warn }, now: () => clock });
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};
const get = (fetch: () => Promise<SourceResult<Payload>>, c = cache(), key = 'usgs:latest:A') =>
  c.get(key, 10 * MINUTE, Payload, fetch);

describe('source cache', () => {
  it('fetches on a miss, stores the result, and reports it as fresh', async () => {
    const fetch = vi.fn(async () => ok({ flow: 1 }));
    expect(await get(fetch)).toEqual({
      status: 'ok',
      data: { flow: 1 },
      fetchedAt: '2026-10-26T12:00:00.000Z',
      cached: false,
    });
    const [row] = await db.select().from(table);
    expect(row).toMatchObject({ key: 'usgs:latest:A', payload: { flow: 1 } });
    expect(row?.expiresAt.toISOString()).toBe('2026-10-26T12:10:00.000Z');
  });

  it('serves a stored result within its TTL without fetching', async () => {
    const c = cache();
    await get(async () => ok({ flow: 1 }), c);
    advance(9 * MINUTE);
    const fetch = vi.fn(async () => ok({ flow: 2 }));
    expect(await get(fetch, c)).toEqual({
      status: 'ok',
      data: { flow: 1 },
      fetchedAt: '2026-10-26T12:00:00.000Z',
      cached: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refetches once the TTL has passed, counting the expiry instant as expired', async () => {
    const c = cache();
    await get(async () => ok({ flow: 1 }), c);
    advance(10 * MINUTE);
    const result = await get(async () => ok({ flow: 2 }), c);
    expect(result).toMatchObject({ status: 'ok', data: { flow: 2 }, cached: false });
    const [row] = await db.select().from(table);
    expect(row?.payload).toEqual({ flow: 2 });
  });

  it('serves the last result marked stale when the source fails after expiry', async () => {
    const c = cache();
    await get(async () => ok({ flow: 1 }), c);
    advance(30 * MINUTE);
    expect(await get(async () => failed, c)).toEqual({
      status: 'stale',
      data: { flow: 1 },
      fetchedAt: '2026-10-26T12:00:00.000Z',
      error: failure,
    });
  });

  it('returns the error when the source fails and nothing is cached', async () => {
    expect(await get(async () => failed)).toEqual({ status: 'error', error: failure });
    expect(await db.select().from(table)).toEqual([]);
  });

  it('keeps the stale row when a refetch fails, so later requests can still use it', async () => {
    const c = cache();
    await get(async () => ok({ flow: 1 }), c);
    advance(30 * MINUTE);
    await get(async () => failed, c);
    const [row] = await db.select().from(table);
    expect(row?.payload).toEqual({ flow: 1 });
  });

  it('makes one fetch for concurrent requests for the same key', async () => {
    const c = cache();
    let release: (value: SourceResult<Payload>) => void = () => {};
    const fetch = vi.fn(() => new Promise<SourceResult<Payload>>((r) => (release = r)));
    const both = Promise.all([get(fetch, c), get(fetch, c)]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    release(ok({ flow: 3 }));
    const [a, b] = await both;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ status: 'ok', data: { flow: 3 } });
  });

  it('does not share fetches across different keys', async () => {
    const c = cache();
    const fetch = vi.fn(async () => ok({ flow: 1 }));
    await Promise.all([get(fetch, c, 'k1'), get(fetch, c, 'k2')]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fetches again after an in-flight request finishes and its result expires', async () => {
    const c = cache();
    const fetch = vi.fn(async () => ok({ flow: 1 }));
    await get(fetch, c);
    advance(11 * MINUTE);
    await get(fetch, c);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('treats a stored payload that no longer matches the schema as a miss, and logs it', async () => {
    await db.insert(table).values({
      key: 'usgs:latest:A',
      payload: { flow: 'not a number' },
      fetchedAt: clock,
      expiresAt: new Date(clock.getTime() + 10 * MINUTE),
    });
    const fetch = vi.fn(async () => ok({ flow: 4 }));
    expect(await get(fetch)).toMatchObject({ status: 'ok', data: { flow: 4 }, cached: false });
    expect(warn).toHaveBeenCalledWith('cache: stored payload did not match schema; refetching', {
      kind: 'usgs:latest',
    });
  });

  it('logs a database failure without the location in the key or the payload', async () => {
    const c = cache();
    await close();
    const fetch = vi.fn(async () => ok({ flow: 5 }));
    await get(fetch, c, 'nws:point:42.5300,-72.5700');
    expect(warn).toHaveBeenCalledWith('cache: read failed', {
      kind: 'nws:point',
      error: expect.any(String),
    });
    expect(warn).toHaveBeenCalledWith('cache: write failed', {
      kind: 'nws:point',
      error: expect.any(String),
    });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('42.53');
    expect(logged).not.toContain('flow');
    ({ db, close } = await createTestDatabase()); // for afterEach
  });

  it('still fetches when the database is unavailable, and logs the failure', async () => {
    const c = cache();
    await close();
    const fetch = vi.fn(async () => ok({ flow: 5 }));
    expect(await get(fetch, c)).toMatchObject({ status: 'ok', data: { flow: 5 }, cached: false });
    expect(warn).toHaveBeenCalledWith('cache: read failed', expect.anything());
    expect(warn).toHaveBeenCalledWith('cache: write failed', expect.anything());
    ({ db, close } = await createTestDatabase()); // for afterEach
  });

  it('fetches within a bounded time when the database stops answering (#122)', async () => {
    const unresponsive = await createUnresponsiveDatabase();
    try {
      const c = createSourceCache({ db: unresponsive.db, logger: { warn }, timeoutMs: 50 });
      const fetch = vi.fn(async () => ok({ flow: 5 }));
      expect(await get(fetch, c)).toMatchObject({ status: 'ok', data: { flow: 5 }, cached: false });
      expect(warn).toHaveBeenCalledWith('cache: read failed', {
        kind: 'usgs:latest',
        error: 'database did not answer within 50 ms',
      });
      expect(warn).toHaveBeenCalledWith('cache: write failed', {
        kind: 'usgs:latest',
        error: 'database did not answer within 50 ms',
      });
    } finally {
      await unresponsive.close();
    }
  });
});

describe('cacheTtlMs', () => {
  it('matches the TTLs in ARCHITECTURE.md (Caching)', () => {
    expect(cacheTtlMs).toEqual({
      usgsLatest: 10 * MINUTE,
      usgsHistory: 10 * MINUTE,
      nwpsStageFlow: 30 * MINUTE,
      nwsForecast: 30 * MINUTE,
      nwsCurrent: 10 * MINUTE,
      nwsAlerts: 5 * MINUTE,
      nwsPoint: 30 * 24 * 60 * MINUTE,
      gaugeMetadata: 7 * 24 * 60 * MINUTE,
      placeSearch: 30 * 24 * 60 * MINUTE,
    });
  });
});
