import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, createUnresponsiveDatabase } from '../../test/database.ts';
import { createErrorLog } from './errorLog.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup(start = 0) {
  const testDb = await createTestDatabase();
  close = testDb.close;
  const output = { warn: vi.fn(), error: vi.fn() };
  let clock = start;
  const log = createErrorLog({ db: testDb.db, output, now: () => clock });
  const rows = async () =>
    (
      await testDb.client.query<{
        level: string;
        message: string;
        details: unknown;
        route: string;
      }>('select level, message, details, route from error_events order by id')
    ).rows;
  return { ...testDb, log, output, rows, tick: (ms: number) => (clock += ms) };
}

describe('createErrorLog', () => {
  it('records a warning from the adapters’ logger, and writes it to the console', async () => {
    const { log, output, rows } = await setup();
    log.logger.warn('usgs: unknown unit, reading skipped', { unit: 'furlongs' });
    await log.flush();
    expect(await rows()).toEqual([
      {
        level: 'warn',
        message: 'usgs: unknown unit, reading skipped',
        details: { unit: 'furlongs' },
        route: null,
      },
    ]);
    expect(output.warn).toHaveBeenCalledWith('usgs: unknown unit, reading skipped', {
      unit: 'furlongs',
    });
  });

  it('records an error with its route', async () => {
    const { log, output, rows } = await setup();
    log.record({ level: 'error', message: 'unhandled exception', route: '/gauges/:ref' });
    await log.flush();
    expect(await rows()).toEqual([
      { level: 'error', message: 'unhandled exception', details: null, route: '/gauges/:ref' },
    ]);
    expect(output.error).toHaveBeenCalledWith('unhandled exception', '');
  });

  it('flushes nothing when nothing was recorded', async () => {
    const { log } = await setup();
    await expect(log.flush()).resolves.toBeUndefined();
  });

  it('deletes rows older than 30 days when recording, at most once an hour', async () => {
    const { log, client, rows, tick } = await setup();
    await client.query(
      "insert into error_events (occurred_at, level, message) values (now() - interval '31 days', 'warn', 'old'), (now() - interval '29 days', 'warn', 'recent')",
    );
    log.logger.warn('new');
    await log.flush();
    expect((await rows()).map((r) => r.message)).toEqual(['recent', 'new']);

    await client.query(
      "insert into error_events (occurred_at, level, message) values (now() - interval '31 days', 'warn', 'old again')",
    );
    log.logger.warn('within the hour');
    await log.flush();
    expect((await rows()).map((r) => r.message)).toContain('old again');

    tick(60 * 60 * 1000);
    log.logger.warn('an hour later');
    await log.flush();
    expect((await rows()).map((r) => r.message)).not.toContain('old again');
  });

  it('writes a failed insert to the console only, without throwing', async () => {
    const { log, client, output } = await setup();
    await client.close();
    close = undefined;
    log.logger.warn('cache: read failed', { key: 'k' });
    await expect(log.flush()).resolves.toBeUndefined();
    expect(output.warn).toHaveBeenCalledWith('error log: write failed', {
      error: expect.any(String),
    });
  });

  it('stops waiting for a write when the database stops answering, so flush ends (#122)', async () => {
    const unresponsive = await createUnresponsiveDatabase();
    try {
      const output = { warn: vi.fn(), error: vi.fn() };
      const log = createErrorLog({ db: unresponsive.db, output, timeoutMs: 50 });
      log.logger.warn('usgs: unknown unit, reading skipped');
      await log.flush();
      expect(output.warn).toHaveBeenCalledWith('error log: write failed', {
        error: 'database did not answer within 50 ms',
      });
    } finally {
      await unresponsive.close();
    }
  });
});
