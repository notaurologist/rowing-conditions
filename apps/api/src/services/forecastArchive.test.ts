import type { ForecastPoint } from '@rowing/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, createUnresponsiveDatabase } from '../../test/database.ts';
import type { Logger } from '../adapters/http.ts';
import { createForecastArchive } from './forecastArchive.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const points = (issuedAt: string, flow: number): ForecastPoint[] => [
  {
    time: '2026-10-27T18:00:00.000Z',
    values: { flow },
    provenance: { flow: { kind: 'forecast', asOf: issuedAt, source: 'nwps', sourceRef: 'MNTM3' } },
  },
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup(start = Date.parse('2026-10-27T18:00:00Z')) {
  const testDb = await createTestDatabase();
  close = testDb.close;
  const warn = vi.fn<Logger['warn']>();
  let clock = start;
  const archive = createForecastArchive({ db: testDb.db, logger: { warn }, now: () => clock });
  const count = async () =>
    Number(
      (await testDb.client.query<{ n: number }>('select count(*)::int as n from forecast_archive'))
        .rows[0]?.n,
    );
  return { ...testDb, archive, warn, count, tick: (ms: number) => (clock += ms) };
}

describe('createForecastArchive (#81)', () => {
  it('keeps each forecast once per gauge and issue time, and reads it back', async () => {
    const { archive, count } = await setup();
    const issued = '2026-10-27T14:44:00.000Z';
    await archive.record('MNTM3', issued, points(issued, 95));
    await archive.record('MNTM3', issued, points(issued, 95)); // fetched again, same issuance
    await archive.record('NFDM3', issued, points(issued, 40));
    expect(await count()).toBe(2);
    const read = await archive.issuedBetween(
      'MNTM3',
      '2026-10-27T00:00:00Z',
      '2026-10-28T00:00:00Z',
    );
    expect(read).toMatchObject([{ ref: 'MNTM3', issuedAt: issued, points: points(issued, 95) }]);
  });

  it('returns forecasts issued in the range, oldest first', async () => {
    const { archive } = await setup();
    for (const issued of [
      '2026-10-27T20:44:00.000Z',
      '2026-10-27T02:44:00.000Z',
      '2026-10-27T14:44:00.000Z',
    ])
      await archive.record('MNTM3', issued, points(issued, 90));
    const read = await archive.issuedBetween(
      'MNTM3',
      '2026-10-27T02:00:00Z',
      '2026-10-27T15:00:00Z',
    );
    expect(read.map((f) => f.issuedAt)).toEqual([
      '2026-10-27T02:44:00.000Z',
      '2026-10-27T14:44:00.000Z',
    ]);
  });

  it('deletes forecasts issued more than 90 days ago when recording, at most once an hour', async () => {
    const { archive, client, count, tick } = await setup();
    const old = new Date(Date.now() - 91 * DAY).toISOString();
    await client.query(
      `insert into forecast_archive (source, ref, issued_at, points) values ('nwps', 'MNTM3', $1, '[]')`,
      [old],
    );
    const recent = new Date(Date.now() - 89 * DAY).toISOString();
    await archive.record('MNTM3', recent, points(recent, 90));
    expect(await count()).toBe(1); // the old one went; the 89-day-old one stays

    await client.query(
      `insert into forecast_archive (source, ref, issued_at, points) values ('nwps', 'NFDM3', $1, '[]')`,
      [old],
    );
    tick(30 * 60_000);
    const next = new Date(Date.now() - DAY).toISOString();
    await archive.record('MNTM3', next, points(next, 90));
    expect(await count()).toBe(3); // not pruned within the hour
    tick(31 * 60_000);
    await archive.record('MNTM3', next, points(next, 90));
    expect(await count()).toBe(2);
  });

  it('logs a failed write without throwing', async () => {
    const { archive, warn, close: closeDb } = await setup();
    await closeDb();
    close = undefined;
    const issued = '2026-10-27T14:44:00.000Z';
    await expect(archive.record('MNTM3', issued, points(issued, 90))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('forecast archive: write failed', {
      error: expect.any(String),
    });
  });

  it('gives up on a database that stops answering, within its time limit', async () => {
    const unresponsive = await createUnresponsiveDatabase();
    try {
      const warn = vi.fn<Logger['warn']>();
      const archive = createForecastArchive({
        db: unresponsive.db,
        logger: { warn },
        timeoutMs: 50,
      });
      const issued = '2026-10-27T14:44:00.000Z';
      await archive.record('MNTM3', issued, points(issued, 90));
      expect(warn).toHaveBeenCalledWith('forecast archive: write failed', {
        error: 'database did not answer within 50 ms',
      });
    } finally {
      await unresponsive.close();
    }
  });

  it('rejects a source it does not know', async () => {
    const { client } = await setup();
    await expect(
      client.query(
        `insert into forecast_archive (source, ref, issued_at, points) values ('usgs', 'X', now(), '[]')`,
      ),
    ).rejects.toThrow(/forecast_archive_source/);
  });
});
