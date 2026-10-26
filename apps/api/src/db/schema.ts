import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// Normalized responses from external sources, keyed by source and request
// (e.g. 'usgs:latest:USGS-01170500'). See ARCHITECTURE.md (Caching).
export const sourceCache = pgTable(
  'source_cache',
  {
    key: text('key').primaryKey(),
    payload: jsonb('payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [check('source_cache_expires_after_fetch', sql`${t.expiresAt} >= ${t.fetchedAt}`)],
);

// Gauges seen in nearby searches, from either source. Populated lazily.
export const gauges = pgTable(
  'gauges',
  {
    ref: text('ref').primaryKey(), // e.g. 'usgs:USGS-01170500', 'nwps:MNTM3'
    source: text('source').notNull(),
    name: text('name').notNull(),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    metrics: text('metrics').array().notNull().default(sql`'{}'::text[]`),
    hasFlowForecast: boolean('has_flow_forecast'), // null until NWPS has been checked
    linkedRef: text('linked_ref'), // the same gauge in the other source, when known
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('gauges_source', sql`${t.source} in ('usgs', 'nwps')`),
    check('gauges_ref_matches_source', sql`${t.ref} like ${t.source} || ':%'`),
    check('gauges_lat', sql`${t.lat} between -90 and 90`),
    check('gauges_lon', sql`${t.lon} between -180 and 180`),
    index('gauges_linked_ref').on(t.linkedRef),
  ],
);

// Shared request gates for services that limit how often the whole app may call them,
// such as Nominatim. One row per gate. See ARCHITECTURE.md (Data fetching).
export const requestGates = pgTable('request_gates', {
  name: text('name').primaryKey(), // e.g. 'nominatim'
  lastStart: timestamp('last_start', { withTimezone: true }).notNull(), // the latest reserved start
});
