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
│   │   │   ├── app.ts       # Hono app and exported AppType; no server, so tests call app.request()
│   │   │   └── index.ts     # Starts the Node server
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
  qualifiers?: Qualifier[];
}

// Internal qualifier names. Adapters map each source's codes to these.
type Qualifier =
  | 'provisional'
  | 'estimated'
  | 'iceAffected'
  | 'equipmentMalfunction';

interface ForecastPoint {
  time: string;                // start of hour, ISO 8601, UTC
  values: Partial<Record<Metric, number | null>>;
  provenance: Partial<Record<Metric, ValueProvenance>>;  // absent = no source supplies this metric
}

interface ValueProvenance {
  kind: 'forecast' | 'observation';  // e.g. flow from NWPS forecast vs latest USGS observation
  asOf: string;                // forecast issue/update time, or observation time; ISO 8601, UTC
  source: SourceId;
  sourceRef?: string;
  interpolated?: boolean;      // e.g. NWPS 6-hourly steps interpolated to hourly
  qualifiers?: Qualifier[];
}

type Unit =
  | 'm3/s' | 'cfs' | 'kcfs'
  | 'm' | 'ft'
  | 'degC' | 'degF'
  | 'm/s' | 'km/h' | 'mph'
  | 'percent';

interface BoatClass {
  id: string;
  name: string;                // user-defined per rule set, e.g. "1x and 2x", "4+ and 8+"
}

interface Threshold {
  id: string;
  metric: Metric;
  comparison: 'min' | 'max';
  boundary: 'inclusive' | 'exclusive';  // inclusive: a value equal to the limit is within
  value: number;               // in the metric's internal unit
  enteredUnit: Unit;           // unit the user typed it in; comparisons happen in this unit
  boatClassIds?: string[];     // undefined = applies to every class in the rule set
}

// Optional hard window, only for clubs that forbid rowing outside it. Light is otherwise context, not a limit.
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

type UnknownReason =
  | 'missing'      // source supplies the metric but has no value for this hour (null, past forecast horizon)
  | 'stale'        // value older than the metric's maximum age
  | 'qualified'    // value carries a qualifier that makes it unreliable
  | 'noSource';    // no source at this location reports the metric at all

type LightLevel = 'daylight' | 'twilight' | 'dark';  // twilight = civil twilight

interface HourResult {
  time: string;
  status: EvaluationStatus;
  light: LightLevel;           // context only; never affects status
  failures: Failure[];
  unknowns: { thresholdId: string; metric: Metric; reason: UnknownReason }[];
}

type Failure =
  | { kind: 'limit'; thresholdId: string; metric: Metric; value: number; limit: number; unit: Unit }  // value and limit rounded, in unit
  | { kind: 'daylight' };      // hour lies entirely outside the rule set's daylight window
```

Every type has a matching Zod schema. Schemas are the source of truth; types are inferred from them. They live in `packages/core/src/types/`, and the schema and its type share a name (`RuleSet` is both).

`SourceId` is `'usgs' | 'nwps' | 'nws'`. A gauge ref is `usgs:<id>` or `nwps:<id>`.

The schemas also enforce these rules:

- **Times** are ISO 8601 written with `Z`. Offsets such as `-04:00` are rejected, so adapters convert to UTC.
- **`ForecastPoint.time`** must be the start of an hour.
- **Provenance:** every metric present in `ForecastPoint.values` needs a matching `provenance` entry.
- **Value ranges** apply to readings and forecast values. Flow, wind speed and gusts can't be negative, rain chance runs from 0 to 1, and wind direction from 0 to below 360.
- **A threshold's `enteredUnit`** must be one of its metric's units (`metricUnits`). Wind direction has no units, so it can't have a limit until directional rules arrive. Combined temperature is entered only in °F.
- **Threshold values:** limits on flow, wind and rain chance must be greater than zero, and rain chance must be at most 1.
- **Boat class scope:** `boatClassIds` is either omitted (every class) or non-empty.
- **Rule sets:** boat class and threshold ids are unique within a rule set, and every scoped threshold names a boat class the rule set has.

### Evaluation

The reasoning behind these rules is in `DOMAIN.md` under "How the app applies limits."

- `evaluateHour(point, ruleSet, boatClassId, daylightTimes, now) → HourResult`
- `evaluateTimeline(forecast, ruleSet, boatClassId, daylightTimes, now) → { hours: HourResult[], unavailableMetrics: Metric[] }`
  - `unavailableMetrics` lists metrics with an applicable threshold but no provenance at any hour (`noSource`), so the UI can show one notice per rule set instead of 48 unknowns.
- `findWindows(timeline, daylightTimes) → { start, end }[]` with ISO 8601 UTC times: contiguous runs of `within` hours, with edges cut at the rule set's daylight window boundaries to the minute.
- `findLimitingFactor(timeline, forecast, ruleSet, boatClassId, daylightTimes) → { metric, reason: 'mostHoursOutside' | 'leastHeadroom', hoursOutside, headroom } | null`
  - Considers only metrics that have a limit applying to the boat class, excluding `unavailableMetrics`, and only rowing hours. Rowing hours are those overlapping the rule set's daylight window, or civil dawn to civil dusk if it has none. The default includes pre-sunrise twilight because crews often push off before sunrise with lights.
  - Picks the metric that causes the most hours to be `outside`. Ties break by least headroom.
  - If no hours are outside, picks the metric with the least headroom (defined below).
  - Returns `null` if no metric qualifies; the UI then falls back to the user's pinned metric or flow.
  - The UI chart defaults to this metric unless the user has pinned one. Tested like the rest of evaluation.
- Evaluation is always per rule set and boat class. The UI may show several rule sets side by side for one location.
- `now` is passed in, never read from the clock, so evaluation stays pure and testable.
- Must be thoroughly unit tested. This is the most important logic in the product.

#### Hour status

For each threshold that applies to the boat class, in this order:

1. If the metric has no provenance at any hour: unknown, `noSource`.
2. If the value is null or absent for this hour: unknown, `missing`.
3. If the value's provenance carries a disqualifying qualifier (`iceAffected`, `equipmentMalfunction`): unknown, `qualified`. `provisional` and `estimated` do not disqualify (`estimated` is an open question in `DOMAIN.md`).
4. If `now - asOf` exceeds the maximum age: unknown, `stale`.
5. Otherwise compare (see "Comparison") and record a `limit` failure if it fails.

Separately, if the rule set has a daylight window and the hour `[time, time + 1h)` lies entirely outside it, add a `daylight` failure. An hour that partly overlaps the window is evaluated normally; `findWindows` trims it. Without a daylight window, light never affects status.

Each hour's `light` is the level at the middle of the hour (`time + 30 min`): `daylight` between sunrise and sunset, `twilight` between civil dawn and sunrise or sunset and civil dusk, `dark` otherwise. UI copy describes it ("before sunrise, twilight") and never turns it into an instruction such as "lights required."

Then: any failure makes the hour `outside`. Otherwise any unknown makes it `unknown`. Only an hour with every applicable threshold present, usable, and passing is `within`. An outside result does not hide unknowns; both lists are returned so the UI can explain both.

For `combinedTempF`, the hour is unknown if either component is unknown, with the component's reason.

#### Maximum ages

Constants in `packages/core`, starting values to tune in M9:

| Metric and kind | Max age of `asOf` |
|---|---|
| flow, gaugeHeight, observation | 6 h |
| waterTemp, observation | 24 h |
| flow, gaugeHeight, NWPS forecast | 36 h |
| weather metrics, NWS forecast | 12 h |

Flow for each hour comes from the NWPS forecast when the gauge has one. Hours after the last forecast step have no flow value (`missing`); the latest observation is not used there. Without a forecast, the latest observation is copied to every hour with `kind: 'observation'`. Water temperature is always the latest observation. The UI shows which applies from `provenance`.

If a rule set names a flow gauge, its flow limit is evaluated against that gauge's data, which may differ from the location's display gauge.

#### Comparison

Comparisons happen in the threshold's `enteredUnit`, at display precision, so the result agrees with the numbers on screen:

1. Convert the reading and the threshold value from SI to `enteredUnit`.
2. Round both to that unit's precision with the same rounding function the UI uses for display.
3. Compare. Max, inclusive: within if `value <= limit`. Max, exclusive: `value < limit`. Min, inclusive: `value >= limit`. Min, exclusive: `value > limit`.

Precision per unit (one table in `packages/core/units`, used by both evaluation and display):

| Unit | Decimals |
|---|---|
| cfs | 0 |
| kcfs | 1 |
| m³/s | 1 |
| ft, m | 2 |
| °F | 0 |
| °C | 1 |
| mph, km/h | 0 |
| m/s | 1 |
| percent | 0 |

Rounding is half away from zero. `combinedTempF` is the sum of air and water temperature each converted to °F and rounded to a whole degree, so its `enteredUnit` is always `degF`.

#### Headroom

Headroom is a unitless margin used only to rank metrics in `findLimitingFactor`. It is computed in SI from the worst value over rowing hours (the highest for a max, the lowest for a min), ignoring unknown hours:

- `margin = limit - worst` for a max, `worst - limit` for a min.
- `headroom = margin / scale`, where `scale` depends on whether the metric has a true zero:
  - flow, windSpeed, windGust, precipChance: `scale = limit`. The rule set editor rejects limits of zero or less for these.
  - waterTemp, airTemp: `scale = 10 °C`.
  - combinedTempF: `scale = 18 °F`.
  - gaugeHeight: `scale = 1 m`. Gauge height is measured from an arbitrary local datum, so a ratio to the limit is meaningless.

Dividing temperatures by their limit would divide by zero at 0 °C and flip sign below it, so temperatures and gauge height use fixed scales. The fixed scales are starting values to tune in M9.

### Units

- Explicit conversion functions per unit pair, no general-purpose library needed.
- Display preferences: `'us'` (cfs, ft, °F, mph) and `'metric'` (m³/s, m, °C, km/h). Store the preference, convert at render.

### Daylight

- Use the `suncalc` library for sunrise, sunset, civil dawn, and civil dusk (suncalc's `dawn` and `dusk`). No external API.
- Light is context by default. See "Hour status" for how light levels are assigned and when a daylight window affects status.

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
  daylight: { date, civilDawn, sunrise, sunset, civilDusk }[],
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

Test files sit next to the code they test as `*.test.ts` or `*.test.tsx`. `pnpm test` runs every package as a Vitest project from the root config. Biome lints and formats code and config, but not Markdown.

- **core:** unit tests for every conversion and evaluation rule, including edge cases (missing values, boundaries, boat class scoping, multiple rule sets, forecast vs observed flow, darkness).
- **adapters:** tests against recorded fixtures in `apps/api/test/fixtures/`. No live network calls in tests, the pre-push check, or CI.
- **api routes:** tests with adapters stubbed by fixtures, covering partial failure.
- **web:** component tests for timeline and thresholds with fixture data.
- Fixture recording is a script (`pnpm fixtures:record`) run manually, never in the pre-push check or CI.
- Historical fixtures from past rowing days double as backtesting cases (see `MILESTONES.md`).

## Tooling

- pnpm workspaces. Exact versions pinned in `package.json`; no `^` ranges.
- Biome for linting and formatting.
- Vitest for tests.
- TypeScript strict mode everywhere, no `any` without a comment explaining why.

## Hosting (MVP)

API and Postgres on Railway or Render; static web build on the same platform or any static host. Decide at deploy milestone and record a decision.
