# Architecture

Status: Draft v0.2

Read `PRODUCT.md` and `DOMAIN.md` first. Decisions behind the choices here are recorded in `docs/decisions/`.

## Principles

1. **Business logic never lives only in a client.** Data fetching, normalization, unit conversion, and threshold evaluation live in `apps/api` or `packages/core`. Clients render. This keeps a future native app cheap.
2. **Conditions, not verdicts.** Code and copy never label conditions safe or unsafe. Evaluation results are "within limits" / "outside limits" / "unknown."
3. **Missing or stale data is a first-class state.** Every value carries its source, observation time, and fetch time. Unknown is never silently treated as fine.
4. **Sources are adapters.** Each external data source sits behind an interface and returns the internal format. Adding a country means adding adapters, not changing the core.
5. **SI internally.** All stored and transmitted measurements are SI. Conversion happens at display time. One documented exception: combined air plus water temperature is computed in °F (see `DOMAIN.md`).

## System overview

```
 ┌──────────────┐     ┌──────────────┐
 │   apps/web   │     │ apps/mobile  │  (later, Expo)
 │ React + Vite │     │              │
 └──────┬───────┘     └──────┬───────┘
        │  typed client (hono/client)
        └─────────┬──────────┘
           ┌──────▼──────┐
           │  apps/api   │  Hono on Node
           │  routes     │
           │  services   │──── packages/core (types, units, evaluation)
           │  adapters   │
           └──┬───────┬──┘
              │       │
      ┌───────▼─┐   ┌─▼──────────────────┐
      │Postgres │   │ External sources    │
      │(cache,  │   │ USGS, NWS, NWPS,    │
      │ gauges) │   │ later Open-Meteo, EA│
      └─────────┘   └─────────────────────┘
```

## Repository layout

```
/
├── AGENTS.md               # Agent entry point (CLAUDE.md imports it)
├── CLAUDE.md
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── routes/      # HTTP layer only: parse input, call services, return output
│   │   │   ├── services/    # Orchestration: cache lookup, adapter calls, merging
│   │   │   ├── adapters/    # One folder per source (usgs/, nws/, ...)
│   │   │   ├── db/          # Drizzle schema, migrations, queries
│   │   │   └── index.ts
│   │   └── test/
│   │       └── fixtures/    # Recorded external API responses
│   └── web/
│       └── src/
│           ├── features/    # location-setup/, conditions/, timeline/, thresholds/
│           ├── components/  # Shared UI
│           ├── lib/         # API client, storage, formatting
│           └── main.tsx
├── packages/
│   └── core/
│       └── src/
│           ├── types/       # Domain types and Zod schemas
│           ├── units/       # Conversion functions
│           ├── evaluation/  # Threshold evaluation (pure functions)
│           └── daylight/    # Sunrise/sunset and darkness windows
└── docs/
```

## packages/core

Pure TypeScript, no I/O, no framework dependencies. Shared by the API, web app, and future mobile app.

### Domain types (sketch)

```ts
type Metric =
  | 'flow'            // m³/s
  | 'gaugeHeight'     // m
  | 'waterTemp'       // °C
  | 'airTemp'         // °C
  | 'windSpeed'       // m/s
  | 'windGust'        // m/s
  | 'windDirection'   // degrees, meteorological (direction wind comes FROM)
  | 'precipChance'    // 0..1
  | 'combinedTempF';  // °F, computed: airTemp°F + waterTemp°F

interface Reading {
  metric: Metric;
  value: number | null;        // null = source reported no value
  observedAt: string;          // ISO 8601, UTC
  fetchedAt: string;           // ISO 8601, UTC
  source: SourceId;            // e.g. 'usgs', 'nws'
  sourceRef?: string;          // e.g. gauge id 'USGS-01170500'
  qualifiers?: string[];       // e.g. provisional, ice-affected
}

interface ForecastPoint {
  time: string;                // start of hour, ISO 8601, UTC
  values: Partial<Record<Metric, number | null>>;
  flowSource?: 'forecast' | 'latestObservation';  // where values.flow came from
}

interface BoatClass {
  id: string;
  name: string;                // user-defined per rule set, e.g. "1x and 2x", "4+ and 8+"
}

interface Threshold {
  id: string;
  metric: Metric;
  comparison: 'min' | 'max';
  value: number;               // in the metric's internal unit
  boatClassIds?: string[];     // undefined = applies to every class in the rule set
}

interface DaylightWindow {
  minutesBeforeSunrise: number;
  minutesAfterSunset: number;
}

interface RuleSet {
  id: string;
  name: string;                // e.g. "Club A rules"; used in UI copy
  boatClasses: BoatClass[];    // at least one
  thresholds: Threshold[];
  daylight?: DaylightWindow;
  flowGaugeRef?: string;       // gauge the flow limit is measured at, e.g. 'nwps:MNTM3', 'usgs:USGS-01170500'
}

interface SavedLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  gaugeRef?: string;           // default gauge for display
  ruleSetIds: string[];        // rule sets shown for this location
}

type EvaluationStatus = 'within' | 'outside' | 'unknown';
```

Every type has a matching Zod schema. Schemas are the source of truth; types are inferred from them.

### Evaluation

- `evaluateHour(point, ruleSet, boatClassId, daylightTimes) → { status, failures[], unknowns[] }`
- `evaluateTimeline(forecast, ruleSet, boatClassId, ...) → per-hour results`
- `findWindows(results) → contiguous ranges where status is 'within'`
- `findLimitingFactor(results, forecast, ruleSet, boatClassId) → { metric, reason: 'mostHoursOutside' | 'leastHeadroom', hoursOutside, headroom }`
  - Considers only metrics that have a limit applying to the boat class, and only daylight hours.
  - Picks the metric that causes the most hours to be `outside`. Ties break by least headroom.
  - If no hours are outside, picks the metric with the least headroom: `(limit - worst value) / limit` for a max, `(worst value - limit) / limit` for a min.
  - Returns `null` if the rule set has no applicable limits; the UI then falls back to the user's pinned metric or flow.
  - The UI chart defaults to this metric unless the user has pinned one. Tested like the rest of evaluation.
- Evaluation is always per rule set and boat class. The UI may show several rule sets side by side for one location.
- Rules: any failing threshold makes the hour `outside`. Otherwise, any threshold whose metric is missing makes it `unknown`. Only all-present, all-passing hours are `within`.
- Flow uses the NWPS forecast for each hour when available (`flowSource: 'forecast'`); otherwise the latest observation applies to all hours (`flowSource: 'latestObservation'`). Water temperature is always the latest observation. The UI must show which applies.
- If a rule set names a flow gauge, its flow limit is evaluated against that gauge's data, which may differ from the location's display gauge.
- Must be thoroughly unit tested. This is the most important logic in the product.

### Units

- Explicit conversion functions per unit pair, no general-purpose library needed.
- Display preferences: `'us'` (cfs, ft, °F, mph) and `'metric'` (m³/s, m, °C, km/h). Store the preference, convert at render.

### Daylight

- Use the `suncalc` library for sunrise and sunset. No external API.

## apps/api

### Framework

Hono on Node. Export the app type so clients use `hono/client` for typed calls. Routes validate input with Zod (`@hono/zod-validator`).

### Endpoints (MVP)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/gauges/nearby?lat&lon&radiusKm` | Gauges near a point, with which metrics each reports and whether a flow forecast exists |
| GET | `/gauges/:ref` | Gauge metadata (`usgs:` or `nwps:` ref) |
| GET | `/conditions?lat&lon&gaugeRef?&flowGaugeRefs?` | Current readings plus 48-hour hourly forecast (including forecast flow where available) and daylight data. `flowGaugeRefs` adds flow series for gauges named by rule sets. |

`/conditions` returns raw normalized data. It does not evaluate rule sets, because rule sets live on the device in the MVP. Clients call `packages/core` evaluation locally. When accounts and notifications arrive, the server runs the same core functions.

### Response shape for `/conditions`

```ts
{
  location: { lat, lon, timezone },
  gauge?: { id, name, lat, lon },
  current: Reading[],
  forecast: ForecastPoint[],          // 48 hourly points
  flowSeries: { gaugeRef, points: { time, flow, source: 'observed' | 'forecast' }[] }[],
  daylight: { date, sunrise, sunset }[],
  alerts: { id, event, headline, severity, onset, ends }[],
  sources: { id, status: 'ok' | 'stale' | 'error', fetchedAt, message? }[]
}
```

Partial success is normal. If NWS fails but USGS succeeds, return what is available with per-source status. Never fail the whole response because one source failed.

### Adapters

```ts
interface FlowSource {
  id: SourceId;
  findNearby(lat: number, lon: number, radiusKm: number): Promise<Gauge[]>;
  getLatest(gaugeId: string): Promise<Reading[]>;
  getHistory(gaugeId: string, from: string, to: string): Promise<Reading[]>;
}

interface FlowForecastSource {
  id: SourceId;                // 'nwps'
  findForecastPoint(lat: number, lon: number, usgsId?: string): Promise<Gauge | null>;
  getStageFlow(gaugeRef: string): Promise<{ observed: Reading[]; forecast: ForecastPoint[]; issuedAt?: string }>;
}

interface WeatherSource {
  id: SourceId;
  getCurrent(lat: number, lon: number): Promise<Reading[]>;
  getHourlyForecast(lat: number, lon: number, hours: number): Promise<ForecastPoint[]>;
  getAlerts(lat: number, lon: number): Promise<Alert[]>;
}
```

Adapter rules:

- Parse every response with a Zod schema. On parse failure, log the raw payload shape and return an error status, never throw raw errors upward.
- Convert to SI inside the adapter. Nothing outside an adapter knows a source's native units.
- Set timeouts on every request (default 10 s).
- Send required headers (NWS requires a `User-Agent` with contact info).
- Details for each source live in `DATA_SOURCES.md`.

### Caching

Fetch on demand, cache in Postgres. No scheduled jobs in the MVP.

- Cache key: source plus request identity (for example `usgs:latest:USGS-01170500`, `nws:forecast:BOX/64,56`).
- TTL per source type (starting points, tune later): USGS latest 10 min, NWPS stage/flow 30 min, NWS hourly forecast 30 min, NWS alerts 5 min, NWS points lookup 30 days, gauge metadata 7 days.
- On upstream failure, serve the last cached value marked `stale` if one exists.
- Deduplicate concurrent fetches for the same key in process.

### Database (Drizzle, Postgres)

MVP tables:

- `source_cache`: `key` (pk), `payload` (jsonb, normalized data), `fetched_at`, `expires_at`.
- `gauges`: `ref` (pk, e.g. `usgs:USGS-01170500`, `nwps:MNTM3`), `source`, `name`, `lat`, `lon`, `metrics` (text[]), `has_flow_forecast` (bool), `linked_ref` (the matching gauge in the other source, when known), `updated_at`. Populated lazily from nearby searches.

Migrations via `drizzle-kit`, committed to the repo.

### Configuration

Environment variables, validated with Zod at startup (fail fast if missing):

- `DATABASE_URL`
- `NWS_USER_AGENT` (app name plus contact email)
- `USGS_API_KEY` (optional)
- `PORT`

No secrets in code or fixtures.

## apps/web

- React with Vite, TypeScript strict mode.
- Server state via TanStack Query, using the typed Hono client.
- Saved locations, rule sets, and unit preference in `localStorage`, behind one storage module. Rule sets are stored independently of locations so one club's rules can be attached to several locations. Stored data is versioned and validated with Zod on read; invalid data is discarded with a migration path, never crashes the app.
- Charts with visx. The 48-hour timeline is a feature folder of its own (`features/timeline/`) with its chart components kept independent of data fetching, so they can be tested with fixture data.
- Map with Leaflet (react-leaflet), OpenStreetMap tiles, respecting the tile usage policy and attribution.
- PWA via `vite-plugin-pwa`. Offline: show last loaded conditions clearly marked with their age.
- Accessibility: status must never be communicated by color alone. Use labels, patterns, or icons alongside color.

## Native path (later)

`apps/mobile` with Expo, reusing `packages/core` and the typed API client. Notifications require server-side scheduled evaluation, which requires rule sets on the server, which requires accounts. Sequence: accounts, server-stored rule sets, scheduled jobs, push notifications. Club-published rule sets come after accounts.

## Testing

- **core:** unit tests for every conversion and evaluation rule, including edge cases (missing values, boundaries, boat class scoping, multiple rule sets, forecast vs observed flow, darkness).
- **adapters:** tests against recorded fixtures in `apps/api/test/fixtures/`. No live network calls in tests or CI.
- **api routes:** tests with adapters stubbed by fixtures, covering partial failure.
- **web:** component tests for timeline and thresholds with fixture data.
- Fixture recording is a script (`pnpm fixtures:record`) run manually, never in CI.
- Historical fixtures from past rowing days double as backtesting cases (see `MILESTONES.md`).

## Tooling

- pnpm workspaces. Exact versions pinned in `package.json`; no `^` ranges.
- Biome for linting and formatting.
- Vitest for tests.
- TypeScript strict mode everywhere, no `any` without a comment explaining why.

## Hosting (MVP)

API and Postgres on Railway or Render; static web build on the same platform or any static host. Decide at deploy milestone and record a decision.
