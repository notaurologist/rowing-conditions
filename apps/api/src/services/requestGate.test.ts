import { afterEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../test/database.ts';
import { createDatabaseGate } from './requestGate.ts';

const INTERVAL = 1100;
// Waits are computed from the database clock, which keeps running while a test runs, so a
// wait can come out a little short of the ideal value. It is never longer.
const SLACK = 250;

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup() {
  const testDb = await createTestDatabase();
  close = testDb.close;
  const waits: number[] = [];
  // A pause that only records, so tests don't wait in real time.
  const sleep = async (ms: number) => {
    waits.push(ms);
  };
  const gate = () =>
    createDatabaseGate({ db: testDb.db, name: 'test', minIntervalMs: INTERVAL, sleep });
  return { ...testDb, waits, gate };
}

function expectWait(actual: number | undefined, ideal: number) {
  expect(actual).toBeLessThanOrEqual(ideal);
  expect(actual).toBeGreaterThan(ideal - SLACK);
}

describe('createDatabaseGate', () => {
  it('lets the first request start at once', async () => {
    const { gate, waits } = await setup();
    await gate()();
    expect(waits).toEqual([]);
  });

  it('spaces back-to-back requests by the minimum interval', async () => {
    const { gate, waits } = await setup();
    const g = gate();
    await g();
    await g();
    await g();
    expect(waits).toHaveLength(2);
    expectWait(waits[0], INTERVAL);
    expectWait(waits[1], 2 * INTERVAL);
  });

  it('spaces concurrent requests from separate gates, as from separate API instances', async () => {
    const { gate, waits } = await setup();
    await Promise.all([gate()(), gate()(), gate()()]);
    const sorted = [...waits].sort((a, b) => a - b);
    expect(sorted).toHaveLength(2);
    expectWait(sorted[0], INTERVAL);
    expectWait(sorted[1], 2 * INTERVAL);
  });

  it('does not wait when the last request started long enough ago', async () => {
    const { gate, waits, client } = await setup();
    const g = gate();
    await g();
    await client.query("update request_gates set last_start = now() - interval '5 seconds'");
    await g();
    expect(waits).toEqual([]);
  });

  it('waits only for the rest of the interval', async () => {
    const { gate, waits, client } = await setup();
    const g = gate();
    await g();
    await client.query("update request_gates set last_start = now() - interval '300 milliseconds'");
    await g();
    expect(waits).toHaveLength(1);
    expectWait(waits[0], INTERVAL - 300);
  });

  it('keeps separate gates apart by name', async () => {
    const { db, waits } = await setup();
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    await createDatabaseGate({ db, name: 'a', minIntervalMs: INTERVAL, sleep })();
    await createDatabaseGate({ db, name: 'b', minIntervalMs: INTERVAL, sleep })();
    expect(waits).toEqual([]);
  });

  it('rejects when the database fails, so the caller can skip the request', async () => {
    const { gate, client } = await setup();
    const g = gate();
    await client.close();
    close = undefined;
    await expect(g()).rejects.toThrow();
  });

  it('spaces real requests in real time', async () => {
    const { db } = await setup();
    const starts: number[] = [];
    const run = async () => {
      await createDatabaseGate({ db, name: 'real', minIntervalMs: 100 })();
      starts.push(performance.now());
    };
    await Promise.all([run(), run(), run()]);
    starts.sort((a, b) => a - b);
    // The gate spaces start times on the database clock; these are the times each caller resumes,
    // which also differ by the callers' query round trips (several ms on a busy CI runner).
    // Without the gate the calls would land a millisecond or two apart.
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(80);
    expect((starts[2] ?? 0) - (starts[1] ?? 0)).toBeGreaterThanOrEqual(80);
  });
});
