import { describe, expect, it } from 'vitest';
import { createTestDatabase } from './database.ts';

describe('createTestDatabase', () => {
  it('applies the committed migrations, including check constraints', async () => {
    const { client, close } = await createTestDatabase();
    const tables = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by 1",
    );
    expect(tables.rows.map((r) => r.tablename)).toEqual([
      'error_events',
      'gauges',
      'request_gates',
      'source_cache',
    ]);
    await expect(
      client.query(
        "insert into gauges (ref, source, name, lat, lon) values ('noaa:X', 'noaa', 'X', 0, 0)",
      ),
    ).rejects.toThrow(/gauges_source/);
    await close();
  });
});
