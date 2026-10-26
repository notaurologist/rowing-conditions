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
  | 'equipmentMalfunction'
  | 'unreliable';    // other codes meaning the value may be wrong, and any unrecognized code

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

The code is in `packages/core/src/evaluation/evaluate.ts`.

- `evaluateHour(point, { ruleSet, boatClassId, lat, lon, now, unavailableMetrics? }) → HourResult`
  - Called on a single hour without `unavailableMetrics`, it can't distinguish `noSource` from `missing`, so an absent value is reported as `missing`. `evaluateTimeline` passes the list in.
  - Throws if the rule set has no such boat class, if `now` isn't a valid UTC time, or if the point fails the `ForecastPoint` schema (for example a time that isn't on the hour). Each of these would otherwise make every value look fresh or misplace the hour. `evaluateTimeline` checks the boat class even when the forecast is empty.
- `evaluateTimeline({ forecast, ruleSet, boatClassId, lat, lon, now, flowByGauge? }) → { hours: HourResult[], unavailableMetrics: Metric[], hasLimits: boolean }`
  - `unavailableMetrics` lists metrics with an applicable threshold but no provenance at any hour (`noSource`), so the UI can show one notice per rule set instead of 48 unknowns. For a combined temperature limit, it lists the part with no source (for example `waterTemp`).
  - `flowByGauge` holds flow series by gauge ref. If the rule set names a flow gauge, each hour's flow is replaced with that gauge's flow for the same hour. If the gauge has no data, flow is `noSource`. It never falls back to the location's display gauge. Only flow moves to the named gauge; a gauge height limit is still evaluated at the display gauge, until a club needs otherwise.
  - `hasLimits` is false when the rule set has no thresholds for the boat class and no daylight window. Every hour would then be vacuously `within`, so `hours` is returned empty: no client can show "within Club A's limits" for a club with none. The UI shows its empty state ("enter your or your club's limits") instead.
- `findWindows(hours, { ruleSet, lat, lon }) → { start, end }[]` returns ISO 8601 UTC times, with `end` exclusive. It's in `packages/core/src/evaluation/windows.ts`.
  - A window is a contiguous run of `within` hours. An `outside` or `unknown` hour ends a run, and so does a gap in the timeline.
  - With a daylight window, edges are cut at the rule set's daylight window, inward to whole minutes. A window never starts before the daylight window opens or ends after it closes.
  - The start is cut by the first hour's solar day and the end by the last hour's.
  - A window that cutting leaves empty is dropped.
  - During polar day nothing is cut.
- `findLimitingFactor(input, timeline) → { metric, reason: 'mostHoursOutside' | 'leastHeadroom', hoursOutside, headroom } | null`
  - It takes the same `input` given to `evaluateTimeline`, plus that call's result. Because of that, it ranks against the same flow series evaluation used, including a rule set's named gauge (`forecastForRuleSet`). It's in `packages/core/src/evaluation/limitingFactor.ts`.
  - Considers only metrics that have a limit applying to the boat class, excluding `unavailableMetrics`, and only rowing hours. Rowing hours are defined as follows:
    - With a daylight window: hours not entirely outside the rule set's window, meaning hours without a `daylight` failure.
    - Without one: hours overlapping civil dawn to civil dusk (`hourOverlapsCivilDaylight`). This includes pre-sunrise twilight, because crews often push off before sunrise with lights.
  - Picks the metric that causes the most hours to be `outside`, even if another metric is further past its limit. An hour counts once per metric, however many of that metric's limits it fails. Ties break by least headroom.
  - A metric with several limits (a min and a max, or limits for different classes that both apply) takes the least headroom among them.
  - A metric with no usable value in any rowing hour has no headroom and isn't considered. That includes unavailable metrics.
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
3. If the value's provenance carries a disqualifying qualifier (`iceAffected`, `equipmentMalfunction`, `estimated`, `unreliable`): unknown, `qualified`. `provisional` does not disqualify. Each adapter maps its source's codes; any code an adapter doesn't recognize becomes `unreliable` and is logged.
4. If `now - asOf` exceeds the maximum age: unknown, `stale`. So is a value dated more than 1 hour after `now` (`futureToleranceHours`), which points to a clock or adapter error rather than unusually fresh data.
5. Otherwise compare (see "Comparison") and record a `limit` failure if it fails.

Separately, if the rule set has a daylight window and the hour `[time, time + 1h)` lies entirely outside it, add a `daylight` failure. An hour that partly overlaps the window is evaluated normally; `findWindows` trims it. Without a daylight window, light never affects status.

The window is measured from the sunrise and sunset of the solar day containing the middle of the hour (`daylightWindowSpan`). During polar day the window covers the whole day. During polar night there's no sunrise to measure from, so every hour is outside the window.

Each hour's `light` is the level at the middle of the hour (`time + 30 min`): `daylight` between sunrise and sunset, `twilight` between civil dawn and sunrise or sunset and civil dusk, `dark` otherwise. UI copy describes it ("before sunrise, twilight") and never turns it into an instruction such as "lights required."

Then: any failure makes the hour `outside`. Otherwise any unknown makes it `unknown`. Only an hour with every applicable threshold present, usable, and passing is `within`. An outside result does not hide unknowns; both lists are returned so the UI can explain both.

For `combinedTempF`, the hour is unknown if either component is unknown. The unknown entry names the component's metric (for example `waterTemp`) and its reason, so the UI can say which reading is the problem. If both are unusable, it names air temperature.

#### Maximum ages

Constants in `packages/core`, starting values to tune in M9:

| Metric and kind | Max age of `asOf` |
|---|---|
| flow, gaugeHeight, observation | 6 h |
| waterTemp, observation | 24 h |
| flow, gaugeHeight, NWPS forecast | 36 h |
| weather metrics, NWS forecast | 12 h |
| weather metrics, observation | 12 h (no agreed limit yet; same as the forecast) |
| waterTemp, forecast | 24 h (no source forecasts it today) |

Flow for each hour comes from the NWPS forecast when the gauge has one. Hours after the last forecast step have no flow value (`missing`); the latest observation is not used there. Without a forecast, the latest observation is copied to every hour with `kind: 'observation'`. Water temperature is always the latest observation. The UI shows which applies from `provenance`.

If a rule set names a flow gauge, its flow limit is evaluated against that gauge's data, which may differ from the location's display gauge.

#### Comparison

Limits are stored at display precision. The `Threshold` schema rejects a value that, converted to its `enteredUnit`, has more decimals than that unit shows, so 15.5 mph is rejected. Rounding such a limit would loosen a maximum: 15.5 would become 16 and let 15.8 through.

Comparisons happen in the threshold's `enteredUnit`, at display precision, so the result agrees with the numbers on screen:

1. Convert the reading and the threshold value from SI to `enteredUnit`.
2. Round both to that unit's precision with the same rounding function the UI uses for display.
3. Compare. Max, inclusive: within if `value <= limit`. Max, exclusive: `value < limit`. Min, inclusive: `value >= limit`. Min, exclusive: `value > limit`.

Precision per unit (`unitDecimals` in `packages/core/src/units/units.ts`, used by both evaluation and display):

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

Rounding is half away from zero (`roundHalfAwayFromZero`). Values are first trimmed to 12 significant digits, so floating-point noise can't push a value across a rounding boundary: 2.675 is stored as 2.67499999… but still rounds to 2.68. `combinedTempF` is the sum of air and water temperature each converted to °F and rounded to a whole degree, so its `enteredUnit` is always `degF`.

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

- Explicit conversion functions per unit pair, no general-purpose library needed. They live in `packages/core/src/units/units.ts`.
- **Conversion functions:**
  - `fromSI` and `toSI` convert between SI and a unit.
  - `fromInternal`, `toInternal` and `displayValue` take the metric as well. Use them for any metric's value: `combinedTempF` is stored in °F, not SI, so these leave it unchanged, and they throw if asked for it in any unit other than °F.
  - `displayValue` returns a value as it appears on screen. Evaluation compares against the same number.
- Display preferences: `'us'` (cfs, ft, °F, mph) and `'metric'` (m³/s, m, °C, km/h). Combined temperature stays in °F in both, and rain chance is always a percent. The mapping is `displayUnits`. Store the preference, convert at render.

### Daylight

- Use the `suncalc` library for sunrise, sunset, civil dawn, and civil dusk (suncalc's `dawn` and `dusk`). No external API. The code is in `packages/core/src/daylight/daylight.ts`.
- **suncalc 2.x behavior:**
  - It works in degrees.
  - It returns `null` for an event that doesn't happen that day, and sets `alwaysUp` or `alwaysDown` when the Sun never crosses the horizon.
  - `getPosition` returns altitude corrected for atmospheric refraction, so classify light levels from `getTimes` event times rather than from altitude.
- **`daylightTimes(date, lat, lon)`** returns civil dawn, sunrise, sunset and civil dusk for a local date, in UTC, plus `sun`: `risesAndSets`, `alwaysUp` or `alwaysDown`.
  - suncalc returns the events of the solar day that contains the instant it's given. Asking at the date's approximate local solar noon therefore selects the right local day with no time zone needed.
  - A summer sunset in the US often falls on the next UTC date. It's still reported with the local day it belongs to.
- **`hourLightLevel(hourStart, lat, lon)`** returns the light level at the middle of the hour.
  - Where the Sun never crosses −6° that day, it falls back to the Sun's altitude: twilight all night in Fairbanks in June, dark in deep polar night.
- Light is context by default. See "Hour status" for how light levels are assigned and when a daylight window affects status.

## apps/api

### Framework

Hono on Node. Export the app type so clients use `hono/client` for typed calls. Routes validate input with Zod (`@hono/zod-validator`).

### Endpoints (MVP)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/gauges/nearby?lat&lon&radiusKm` | `{ gauges: NearbyGauge[] }`, nearest first, each with the metrics it reports. `radiusKm` defaults to 25, max 100. Whether a flow forecast exists is added with the NWPS adapter (#18). |
| GET | `/gauges/:ref` | `{ gauge, latest: Reading[], sources }` for a `usgs:` ref. Returns 404 if there's no such gauge. If the readings fail, it still returns the gauge, with that source marked `error`. `nwps:` refs get 501 until #18. |
| GET | `/conditions?lat&lon&gaugeRef?&flowGaugeRefs?` | Current readings plus 48-hour hourly forecast (including forecast flow where available) and daylight data. `flowGaugeRefs` (comma-separated, up to 5) adds flow series for gauges named by rule sets. Always 200 on valid input; failures are reported per source. |
| GET | `/places/search?q` | `{ places: Place[] }` from Nominatim, US only, at most 5. `q` is 2 to 200 characters. Clients call it only when the user submits a search (the usage policy forbids autocomplete). Returns 503 when `GEOCODING_ENABLED=false`. |

Routes validate input with `@hono/zod-validator` and answer 400 on invalid input. An adapter failure becomes 502 with `{ error: { source, kind, message } }`. `createApp(deps)` takes the adapters, so route tests pass in fake ones.

`/conditions` returns raw normalized data. It does not evaluate rule sets, because rule sets live on the device in the MVP. Clients call `packages/core` evaluation locally. When accounts and notifications arrive, the server runs the same core functions.

### Response shape for `/conditions`

```ts
// Zod schema: ConditionsResponse in apps/api/src/services/conditions.ts
{
  location: { lat, lon, timezone: string | null, place? },   // timezone from NWS; null if NWS failed
  gauge?: { ref, name, lat, lon },
  current: Reading[],                 // station or forecast weather, plus the gauge's latest readings
  currentBasis?: 'station' | 'forecast',
  station?: { id, name, distanceKm },
  forecast: ForecastPoint[],          // 48 hourly points
  flowSeries: { gaugeRef, points: ForecastPoint[] }[],  // flow values with full provenance (asOf, kind, qualifiers), so stale and qualifier checks work for rule-set gauges
  daylight: { date, civilDawn, sunrise, sunset, civilDusk }[],
  alerts: { id, event, headline, severity, onset, ends }[],
  sources: { id, status: 'ok' | 'stale' | 'error', fetchedAt, message? }[]
}
```

Partial success is normal. If NWS fails but USGS succeeds, return what is available with per-source status. Never fail the whole response because one source failed.

How `getConditions` builds it (`apps/api/src/services/conditions.ts`):

- **Through the cache:** every source call goes through the source cache. The NWS forecast is cached 72 hours deep and cut to the 48 hours from the current hour, so a cached forecast doesn't drift behind.
- **River values for each hour** come from `riverHours`:
  - flow and gauge height from the NWPS forecast where it covers the hour, missing after it ends, and the latest observation before it starts
  - without a forecast, the latest observation copied to every hour
  - water temperature always from the latest observation
- **USGS gauges** are linked to NWPS by site number. The stage-and-flow forecast is fetched only when the gauge has one.
- **`daylight`** covers each local solar date in the window, so it doesn't need a time zone.
- **`sources`** has one entry per source used: `error` if any call failed with nothing cached, otherwise `stale` if any was served stale, otherwise `ok`. `fetchedAt` is that source's oldest data in the response.
- **When every source fails** with nothing cached, the response is still 200 and still valid: empty readings, 48 empty forecast hours, and every source `error`.

### Adapters

Every adapter method returns a `SourceResult<T>` and never throws:

```ts
type SourceResult<T> = { ok: true; data: T } | { ok: false; error: SourceError };
interface SourceError { source: SourceId; kind: 'timeout' | 'network' | 'http' | 'parse'; message: string; status?: number }

// apps/api/src/adapters/types.ts. Implemented by apps/api/src/adapters/usgs/usgs.ts.
interface FlowSource {
  id: SourceId;
  findNearby(lat: number, lon: number, radiusKm: number): Promise<SourceResult<NearbyGauge[]>>;  // nearest first
  getGauge(gaugeId: string): Promise<SourceResult<Gauge | null>>;   // null when the gauge doesn't exist
  getLatest(gaugeId: string): Promise<SourceResult<Reading[]>>;
  getHistory(gaugeId: string, metric: Metric, from: string, to: string): Promise<SourceResult<Reading[]>>;  // one metric per request
}

// Implemented by apps/api/src/adapters/nwps/nwps.ts.
interface FlowForecastSource {
  id: SourceId;                // 'nwps'
  findNearby(lat: number, lon: number, radiusKm: number): Promise<SourceResult<NearbyGauge[]>>;  // each with hasFlowForecast
  getGauge(identifier: string): Promise<SourceResult<Gauge | null>>;  // NWS location ID, or a bare USGS site number to find its forecast point
  getStageFlow(lid: string): Promise<SourceResult<{ observed: Reading[]; forecast: ForecastPoint[]; issuedAt: string | null }>>;
}

// Implemented by apps/api/src/adapters/nws/nws.ts.
interface WeatherSource {
  id: SourceId;
  getPoint(lat: number, lon: number): Promise<SourceResult<{ gridId, gridX, gridY, timeZone, place? }>>;
  getHourlyForecast(lat: number, lon: number, hours: number): Promise<SourceResult<ForecastPoint[]>>;  // from the current hour
  getCurrent(lat: number, lon: number): Promise<SourceResult<{ basis: 'station' | 'forecast'; station?: { id, name, distanceKm }; readings: Reading[] }>>;
  getAlerts(lat: number, lon: number): Promise<SourceResult<Alert[]>>;
}
```

Adapter rules:

- Parse every response with a Zod schema. On parse failure, log the raw payload shape and return an error status, never throw raw errors upward. `fetchJson` in `apps/api/src/adapters/http.ts` does this for every adapter: it handles timeouts, network and HTTP errors, and schema mismatches. It logs only the payload's shape (keys and types), never its values.
- Adapters take `fetch`, `logger` and `now` as options. Tests inject a `routedFetch` (`apps/api/test/fixtures.ts`) that serves recorded fixtures and fails on any request it doesn't expect, so no test can reach the network.
- `Gauge` and `NearbyGauge` (a gauge plus `distanceKm`) are Zod schemas in `packages/core/src/types/gauge.ts`. `distanceKm` and `boundingBox` are in `packages/core/src/geo/geo.ts`.
- A reading the core `Reading` schema rejects, for example a negative discharge, is kept with a null value and logged. That makes it `missing`, never dropped silently.
- **NWS:**
  - **Requests:** the adapter sends `NWS_USER_AGENT` on every request and retries a 5xx once after a pause. It never retries a 4xx.
  - **Forecast:** grid intervals (`PT3H`, `P1D`, …) are expanded to hours. An hour that no interval covers is `null`, which means missing, not absent. Units are converted from their WMO codes, and a series in an unknown unit is skipped and logged.
  - **Current weather** follows #19: the nearest station within 30 km whose observation is no more than 2 hours old. Otherwise it's the forecast's current hour, with `basis: 'forecast'`.
  - **Quality control:** station values that NWS quality control marked rejected (`X`) or questioned (`Q`) are `unreliable`.
  - **Alerts:** times are normalized to UTC. A missing `ends` falls back to `expires`, and an unknown severity becomes `Unknown`.
  - **`Alert`** is a schema in `packages/core/src/types/alert.ts`.
- **Nominatim** (place search, not a data source): every request goes through an in-process gate, one at a time, each starting at least 1.1 s after the previous one, so the app stays under the policy's one request per second. The gate is per process; the API runs as one. Results are cached for 30 days by normalized query (trimmed, single-spaced, lowercase). A result with coordinates out of range is dropped and logged.
- **NWPS forecast:** `getStageFlow` turns the 6-hourly forecast into hourly `ForecastPoint`s with `interpolateHourly` (`packages/core/src/series/interpolate.ts`). It's linear between steps and never extrapolates. An hour next to a missing step is null. Hours between steps carry `interpolated: true`, and every hour's provenance `asOf` is the forecast issue time. A gauge without a forecast returns `forecast: []` and `issuedAt: null`.
- Convert to SI inside the adapter. Nothing outside an adapter knows a source's native units.
- Set timeouts on every request (default 10 s).
- Send required headers (NWS requires a `User-Agent` with contact info).
- Details for each source live in `DATA_SOURCES.md`.

### Caching

Fetch on demand, cache in Postgres. No scheduled jobs in the MVP.

- Cache key: source plus request identity (for example `usgs:latest:USGS-01170500`, `nws:forecast:BOX/64,56`).
- **TTL per source type** (starting points, tune later; `cacheTtlMs`):
  - USGS latest and history: 10 min
  - NWPS stage/flow: 30 min
  - NWS hourly forecast: 30 min
  - NWS current observations: 10 min
  - NWS alerts: 5 min
  - NWS points lookup: 30 days
  - Gauge metadata: 7 days
  - Nominatim place search: 30 days (places don't move, and the usage policy asks for caching)
- **On upstream failure**, serve the last cached value marked `stale` if one exists.
- **Concurrent fetches** for the same key are deduplicated in process.
- **Implementation:** `createSourceCache({ db, logger, now })` in `apps/api/src/services/sourceCache.ts`. `cache.get(key, ttlMs, schema, fetch)` returns one of three results:
  - `{ status: 'ok', data, fetchedAt, cached }`: a fresh stored result, or a new fetch.
  - `{ status: 'stale', data, fetchedAt, error }`: the source failed after expiry, so the last result is served.
  - `{ status: 'error', error }`: the source failed and nothing is cached.
- **Expiry:** a stored result is fresh until strictly before `expires_at`, and a failed refetch keeps the old row.
- **Stored payloads** are re-parsed with the schema on read. A payload from an older shape is treated as a miss and logged.
- **The cache is an optimization:** a database read or write failure is logged and the request goes to the source directly.

### Database (Drizzle, Postgres)

MVP tables:

- `source_cache`: `key` (pk), `payload` (jsonb, normalized data), `fetched_at`, `expires_at`.
- `gauges`: `ref` (pk, e.g. `usgs:USGS-01170500`, `nwps:MNTM3`), `source`, `name`, `lat`, `lon`, `metrics` (text[]), `has_flow_forecast` (bool), `linked_ref` (the matching gauge in the other source, when known), `updated_at`. Populated lazily from nearby searches.

Migrations via `drizzle-kit`, committed to the repo:

- **Schema:** `apps/api/src/db/schema.ts`. Migrations go in `apps/api/drizzle/`, and Biome skips that generated folder.
- **Driver:** postgres.js (`postgres`).
- **Check constraints:** `gauges.source` is `usgs` or `nwps`, `ref` starts with its source, latitude and longitude are in range, and `source_cache.expires_at >= fetched_at`.
- **`has_flow_forecast`** is nullable: null means NWPS hasn't been checked yet.
- **Local database:** `docker-compose.yml` runs `postgres:18` (decision 0013). `drizzle.config.ts` falls back to that container's URL when `DATABASE_URL` is unset.
- **Migrating:** `pnpm db:migrate` applies migrations. Re-running it is a no-op.

### Configuration

Environment variables, validated with Zod at startup (fail fast if missing). It's `loadConfig` in `apps/api/src/config.ts`, and it lists every problem by variable name without echoing values:

- `DATABASE_URL`: a `postgres://` or `postgresql://` URL
- `NWS_USER_AGENT`: app name plus contact email. Required, because NWS answers 403 without it.
- `USGS_API_KEY`: optional. An empty value counts as no key.
- `GEOCODING_ENABLED`: optional, `true` by default. `false` turns place search off without a code change, as Nominatim's policy requires. Nominatim requests send `NWS_USER_AGENT` to identify the app.
- `PORT`: defaults to 3000

`.env.example` at the repo root lists them. `pnpm dev` and `start` load `.env` from the repo root if it exists (`node --env-file-if-exists`).

No secrets in code or fixtures.

## apps/web

- React with Vite, TypeScript strict mode.
- Server state via TanStack Query, using the typed Hono client (`src/lib/api.ts`). Response types come from the API's `AppType`, so a route change that breaks the web app is a type error. Every call throws on a non-2xx response, so a failed request is an error state, never empty data. In development Vite proxies `/api` to the API on :3000; `VITE_API_URL` overrides the base URL.
- Saved locations, rule sets, and unit preference in `localStorage`, behind one storage module (`src/lib/storage.ts`). Rule sets are stored independently of locations so one club's rules can be attached to several locations.
  - Each kind of data has its own key (`rowing-conditions:locations`, `:rule-sets`, `:preferences`), so corrupt data under one key never costs the others.
  - Each value is `{ version, data }`. On read, older versions are migrated one step at a time (`migrations[n]` turns version n into n + 1) and the data is validated with Zod.
  - Data that can't be read (bad JSON, no envelope, no migration path, failed validation) is discarded and logged. In a list, only the invalid items are dropped. Data from a newer version is left in place and defaults are used. Reading never throws.
  - Writes are validated first. A failed write (quota, blocked storage) throws to the caller, which must show it.
- A root error boundary shows a message and a reload button instead of a blank page.
- Charts with visx. The 48-hour timeline is a feature folder of its own (`features/timeline/`) with its chart components kept independent of data fetching, so they can be tested with fixture data.
- Map with Leaflet (react-leaflet), OpenStreetMap tiles, respecting the tile usage policy and attribution. The tile URL is configurable (`VITE_TILE_URL`), as the policy asks, and Leaflet loads lazily because it needs `window`.
- **Location setup** (`src/features/location-setup/`): pick a point on the map or use the browser's location, then choose a gauge from `/gauges/nearby`. `defaultGauge` (`packages/core/src/geo/defaultGauge.ts`) suggests the nearest gauge reporting flow, else gauge height, else water temperature; with none, the suggestion is weather-only. The user can pick any listed gauge or weather-only. Each gauge shows its distance and what it reports. Saving waits for the gauge list, so the saved choice is one the user saw.
- PWA via `vite-plugin-pwa`. Offline: show last loaded conditions clearly marked with their age.
- Accessibility: status must never be communicated by color alone. Use labels, patterns, or icons alongside color.

## Native path (later)

`apps/mobile` with Expo, reusing `packages/core` and the typed API client. Notifications require server-side scheduled evaluation, which requires rule sets on the server, which requires accounts. Sequence: accounts, server-stored rule sets, scheduled jobs, push notifications. Club-published rule sets come after accounts.

## Testing

Test files sit next to the code they test as `*.test.ts` or `*.test.tsx`. `pnpm test` runs every package as a Vitest project from the root config. Biome lints and formats code and config, but not Markdown. Database tests use PGlite (decision 0016): `createTestDatabase()` in `apps/api/test/database.ts` gives a fresh in-memory Postgres with the committed migrations applied, so no test needs Docker.

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
