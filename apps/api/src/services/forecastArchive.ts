import { ForecastPoint } from '@rowing/core';
import { and, asc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { describeError, type Logger } from '../adapters/http.ts';
import { DATABASE_TIMEOUT_MS, type Database, withTimeout } from '../db/client.ts';
import { forecastArchive } from '../db/schema.ts';

export const FORECAST_RETENTION_DAYS = 90;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

const Points = z.array(ForecastPoint);

export interface ArchivedForecast {
  ref: string;
  issuedAt: string;
  recordedAt: string;
  points: ForecastPoint[];
}

export interface ForecastArchive {
  // Keeps an NWPS forecast, once per gauge and issue time. Never throws: a failed write is
  // logged, and the request carries on without it.
  record(ref: string, issuedAt: string, points: readonly ForecastPoint[]): Promise<void>;
  // The forecasts for a gauge issued in [from, to], oldest first. For backtesting.
  issuedBetween(ref: string, from: string, to: string): Promise<ArchivedForecast[]>;
}

export interface ForecastArchiveOptions {
  db: Database;
  logger: Logger;
  now?: () => number; // milliseconds, for deciding when to prune
  timeoutMs?: number;
}

// NWPS flow forecasts as fetched, kept 90 days (#81). NWPS serves only its current forecast, so
// a forecast can only be compared with what was measured if it's kept when fetched. Old rows go
// as part of recording new ones, so no scheduled job is needed (decision 0006).
export function createForecastArchive(options: ForecastArchiveOptions): ForecastArchive {
  const { db, logger } = options;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DATABASE_TIMEOUT_MS;
  let lastPrune = Number.NEGATIVE_INFINITY;

  return {
    async record(ref, issuedAt, points) {
      try {
        await withTimeout(
          db
            .insert(forecastArchive)
            .values({ source: 'nwps', ref, issuedAt: new Date(issuedAt), points })
            .onConflictDoNothing(),
          timeoutMs,
        );
      } catch (error) {
        logger.warn('forecast archive: write failed', { error: describeError(error) });
        return;
      }
      if (now() - lastPrune < PRUNE_INTERVAL_MS) return;
      lastPrune = now();
      try {
        await withTimeout(
          db
            .delete(forecastArchive)
            .where(
              lt(
                forecastArchive.issuedAt,
                sql`now() - (${FORECAST_RETENTION_DAYS}::int * interval '1 day')`,
              ),
            ),
          timeoutMs,
        );
      } catch (error) {
        logger.warn('forecast archive: pruning failed', { error: describeError(error) });
      }
    },

    async issuedBetween(ref, from, to) {
      const rows = await withTimeout(
        db
          .select()
          .from(forecastArchive)
          .where(
            and(
              eq(forecastArchive.source, 'nwps'),
              eq(forecastArchive.ref, ref),
              gte(forecastArchive.issuedAt, new Date(from)),
              lte(forecastArchive.issuedAt, new Date(to)),
            ),
          )
          .orderBy(asc(forecastArchive.issuedAt)),
        timeoutMs,
      );
      return rows.map((row) => ({
        ref: row.ref,
        issuedAt: row.issuedAt.toISOString(),
        recordedAt: row.recordedAt.toISOString(),
        points: Points.parse(row.points),
      }));
    },
  };
}
