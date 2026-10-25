# Data Sources

Status: Draft v0.4. USGS and NWS verified October 25, 2026; NWPS verified in #63; other sources as of October 2026.

**Before implementing or changing any adapter, verify the details below against the source's official documentation.** APIs change (USGS is mid-migration as of this writing). If the docs differ from this file, follow the docs and update this file in the same change.

General rules for all adapters are in `ARCHITECTURE.md` (Zod parsing, SI conversion, timeouts, caching).

---

## USGS Water Data APIs (US flow, gauge height, water temperature)

Verified against the live API on October 25, 2026 (issue #13). Facts below come from real responses unless marked otherwise.

- **Docs:** https://api.waterdata.usgs.gov/docs/ (OpenAPI with query builder). Field descriptions are also served at `/collections/{id}/queryables?f=json`.
- **Base URL:** `https://api.waterdata.usgs.gov/ogcapi/v1`
- **Do not use** the legacy WaterServices API (`waterservices.usgs.gov`). It is being decommissioned: degradation from November 16, 2026, full retirement in early 2027. Many tutorials and code samples online still use it, and some examples use the earlier `v0` path. Use `v1`.
- **Auth:** none required. An optional API key (sign up at https://api.waterdata.usgs.gov/signup/) raises rate limits. Send it as an `X-Api-Key` header or `api_key` query parameter; both are honored. An invalid key returns **403**, so never send an empty or placeholder key: omit it when `USGS_API_KEY` is unset.
- **Rate limits:** not documented on the docs or signup pages, and no rate-limit headers are returned. Cache as `ARCHITECTURE.md` describes, and treat a 429 or 403 as an upstream error.
- **Format:** OGC API Features. Add `f=json` to get JSON (browsers default to HTML). Responses are GeoJSON: `{ type, features, numberReturned, links, timeStamp }`, with records in `features[].properties`. `numberMatched` is not always present.
- **Paging:** `limit` is capped at 50,000. Larger values return 400 `InvalidParameterValue`. More results are signaled by a `links` entry with `rel: "next"`.

### Collections we use

| Collection | Use |
|---|---|
| `monitoring-locations` | Gauge metadata and nearby search (`bbox=minLon,minLat,maxLon,maxLat`; `site_type_code=ST` for streams) |
| `latest-continuous` | Most recent reading per time series at a gauge |
| `continuous` | Recent and historical readings (trend, backtesting). `time=PT6H` returns the last 6 hours, in ascending time order |
| `time-series-metadata` | Which parameters a gauge reports, and from when |
| `parameter-codes` | Reference for parameter codes |

Also available but not used yet: `daily`, `latest-daily`, `field-measurements`, `combined-metadata`, `statistic-codes`.

### Identifiers and parameters

- Monitoring location IDs combine agency and number: `USGS-01170500`.
- Parameter codes and the units they come back in (`unit_of_measure`):
  - `00060` discharge, `ft^3/s`. Convert to m³/s.
  - `00065` gauge height, `ft`. Convert to m.
  - `00010` water temperature, `degC`.
- **Statistic:** real-time readings have `statistic_id` `00011` (instantaneous). In `time-series-metadata`, the same series shows `computation_period_identifier: "Points"`. A few latest readings have a null `statistic_id`; filter on `00011`.
- **Filters:** `monitoring_location_id` and `parameter_code` both accept comma-separated lists (checked with two gauges and three parameters in one request). Use `skipGeometry=true` when coordinates are not needed, and `properties=` to trim fields.
- **Response fields that matter:**
  - `value` is a **string** (for example `"2120"`), to preserve precision, and may be `null`. Parse it to a number in the adapter.
  - `time` uses an offset (`2026-10-25T17:15:00+00:00`), not `Z`. Normalize to `Z` before it reaches the core schemas, which require `Z`.
  - `qualifier` is an **array of strings** or `null` (for example `["ICE"]`, `["DISCONTINUED", "EQUIP"]`), even though the queryables page describes it as a string.
  - `approval_status` is `"Provisional"` or `"Approved"`.

### Qualifiers

USGS does not publish a code list in the v1 API or its docs. The codes are descriptive words, and their meanings below are inferred from their names and from the legacy WaterServices codes.

These are the codes seen across about 25,000 latest readings for flow, gauge height and water temperature:

| Code | Count | Meaning | Value usually | Internal mapping |
|---|---|---|---|---|
| (approval) `Provisional` | most | Not yet reviewed; may be revised | present | `provisional` |
| `ESTIMATED` | 83 | Value estimated, often during ice | present | `estimated` (disqualifying) |
| `ICE` | 26 | Ice affected | null | `iceAffected` (disqualifying) |
| `EQUIP` | 116 | Equipment malfunction | null | `equipmentMalfunction` (disqualifying) |
| `MAINT` | 20 | Under maintenance | null | `unreliable` (disqualifying) |
| `FLOOD` | 14 | Flood damage to the gauge | null | `unreliable` (disqualifying) |
| `BACKWATER` | 48 | Backwater; stage–discharge relation affected | null | `unreliable` (disqualifying) |
| `RATINGDEV` | 35 | Rating being developed | null | `unreliable` (disqualifying) |
| `DEBRIS` | 5 | Debris affecting the record | present | `unreliable` (disqualifying) |
| `DAMFAILURE` | 3 | Dam failure | present | `unreliable` (disqualifying) |
| `TEST` | 3 | Test data | present | `unreliable` (disqualifying) |
| `GHNOTASSCPKQ` | 1 | Unclear | null | `unreliable`, as an unrecognized code |
| `DISCONTINUED` | 894 | Gauge discontinued | old | ignore; the stale check catches it |
| `SEASONAL` | 256 | Seasonal gauge, out of season | null or old | ignore; missing or stale |
| `UNAVAIL` | 75 | Data unavailable | null or old | ignore; missing or stale |
| `DRY` | 40 | Channel dry | `0.00` or null | ignore |
| `ZEROFLOW` | 14 | Zero flow | null | ignore |
| `LESSTHAN` | 15 | Actual value is less than reported | present | `unreliable` (disqualifying); the true value is lower, which matters for minimum limits |
| `BLWMIN` | 7 | Below the sensor's minimum | present | `unreliable` (disqualifying); the true value is lower, which matters for minimum limits |
| `REVISED` | 19 | Value revised | present | ignore |
| `URBAN`, `REGULATED`, `TIDE`, `DIFFDATUM`, `OTHERAGENCY`, `OPPORTUNISTIC`, `FORCEINTERPOLATION` | ≤ 7 each | Informational | present | ignore |

Most reliability codes come with a null value, so those readings are already `missing`.

**Decided in #13:**
- The codes marked `unreliable` above map to the internal disqualifying qualifier `unreliable`.
- Any code not listed here is also treated as `unreliable`, and the adapter logs it so the table can be updated. The same applies to an `approval_status` other than `Provisional` or `Approved`.
- Only the codes marked "ignore" are dropped.
- The mapping is in `apps/api/src/adapters/usgs/qualifiers.ts`.

### Quirks

- **Reporting interval:** readings are typically every 15 minutes, but telemetry delays vary by gauge, and some gauges lag by hours.
- **Revisions:** recent data is provisional and can be revised. Preserve qualifiers.
- **Winter:** gauges may report ice-affected values or none at all. Ice-affected readings usually come with a null value and the `ICE` qualifier.
- **Water temperature:** many gauges don't report it. Check `time-series-metadata` rather than assuming. For example, the Connecticut River at Montague City (`USGS-01170500`) reports flow and gauge height but not water temperature, while the gauge near Northfield (`USGS-01161280`), about 10 km upstream, reports all three.
- **`time-series-metadata` `end` lags.** For Montague City it was about 12 hours behind the latest reading. Use it to see which parameters a gauge reports, not how fresh they are.
- **Trend:** rising or falling needs recent history from `continuous`, not just `latest-continuous`. At Montague City on October 25, flow fell from 3,370 to 2,120 ft³/s over 5 hours.

---

## NOAA National Water Prediction Service (US flow forecasts)

- **Docs:** https://api.water.noaa.gov/nwps/v1/docs/ (OpenAPI). Overview: https://water.noaa.gov/about/api
- **Base URL:** `https://api.water.noaa.gov/nwps/v1`
- **What it provides:** official NWS streamflow forecasts and stream observations, flood categories, and location metadata for NWS forecast points. This is the data behind the `water.noaa.gov/gauges/<id>` hydrograph pages clubs link to.
- **Coverage:** only gauges where a River Forecast Center issues forecasts. Many gauges have observations but no forecast; handle that as a normal case.
- **History:** the API holds no historical observations beyond crest and low-water history. Backtesting uses USGS `continuous` data instead.
- **Auth:** none known. Confirm in the docs.

### Endpoints we use

| Endpoint | Use |
|---|---|
| `GET /gauges/{lid}` | Gauge metadata, including the linked USGS site when there is one |
| `GET /gauges/{lid}/stageflow` | Observed and forecast stage and flow time series |
| `GET /gauges` (with bounding box filters) | Finding forecast points near a location |

### Identifiers and quirks

- Gauges use 5-character NWS location IDs (for example `MNTM3`, Connecticut River at Montague), case-insensitive in URLs.
- Observed values usually originate from USGS gauges. Link the two (`gauges.linked_ref`) rather than showing duplicate gauges to users.
- Check stated units per series; flow is commonly reported in kcfs. Convert to m³/s in the adapter.
- Forecasts are issued on River Forecast Center schedules, often only a few times per day. Store and show the issue time.
- Forecast steps are often 6-hourly. Interpolate to hourly for the timeline, and mark interpolated values internally.

---

## National Weather Service API (US forecasts and alerts)

Verified against the live API on October 25, 2026 (issue #19).

- **Docs:** https://www.weather.gov/documentation/services-web-api
- **Base URL:** `https://api.weather.gov`
- **Auth:** none. A `User-Agent` header identifying the app and a contact email is **required**. A request without one gets **403**. Read it from `NWS_USER_AGENT`.
- **Coverage:** US only.
- **Format:** GeoJSON, with records under `properties`. Times carry offsets, local ones on alerts (`-08:00`), so normalize to `Z`.
- **Caching headers:** grid data comes with `Cache-Control: max-age=3600` and `Last-Modified`, and the payload has `updateTime`. Use `updateTime` as the forecast's `asOf`.

### Flow

1. `GET /points/{lat},{lon}`. Coordinates with more than 4 decimals get a **301** redirect to the rounded point, so round to 4 before requesting. The response gives:
   - the grid: `gridId` (`BOX`), `gridX` and `gridY`
   - URLs: `forecastGridData` and `observationStations`
   - the location's **`timeZone`** (`America/New_York`), which `/conditions` can use as its location time zone
   - `relativeLocation`, the nearest named place (`Turners Falls`)

   The mapping from point to grid rarely changes, so cache it for 30 days.
2. `GET /gridpoints/{office}/{x},{y}` (the `forecastGridData` URL) returns raw time series. Prefer it over `forecastHourly`, which returns pre-formatted strings. Each series has a `uom` and `values: [{ validTime, value }]`:
   - `temperature`: `wmoUnit:degC`
   - `windSpeed` and `windGust`: `wmoUnit:km_h-1`. Values are knot multiples converted to km/h (1.852, 3.704, …).
   - `windDirection`: `wmoUnit:degree_(angle)`
   - `probabilityOfPrecipitation`: `wmoUnit:percent`. Convert to a 0–1 fraction.
   - The data covers `validTimes`, here 7½ days from 13:00Z.
3. `GET /alerts/active?point={lat},{lon}` returns `{ features: [...] }`. Each alert's `properties` include `id`, `event`, `headline`, `severity`, `onset`, `ends`, `expires` and `effective`. `ends` can be null, so fall back to `expires`.
4. **Current observations:** `GET /gridpoints/{office}/{x},{y}/stations` lists observation stations nearest first, followed by `GET /stations/{id}/observations/latest`. Each value is `{ unitCode, value, qualityControl }`, and `windGust` is null when there's no gust. The nearest station to Turners Falls is Orange Municipal Airport (`KORE`), 22 km away.

### Current conditions: decided in #19

Current weather comes from the **nearest station's latest observation, if it's within 30 km and no more than 2 hours old**. The UI labels it with the station name and distance, and takes freshness from its `timestamp`. Otherwise, current weather is the grid forecast's value for the current hour, labeled as a forecast.

The reasons: a nearby station measures conditions rather than predicting them, but stations are mostly airports, can be far from the water, and report late (Chicopee's latest was 2 hours old). The thresholds are starting values to tune in M9. Evaluation is unaffected: it uses the hourly forecast throughout, as before.

### Quirks

- **Intervals:** grid values span ISO 8601 intervals (`PT1H`, `PT3H`, `P1D`; precipitation chance was daily for the first day), so one value can cover several hours. Expand to hourly points.
- **Units** are given as WMO codes. Convert based on the stated unit, never assume.
- **Missing values:** `windGust` can be missing for some hours. Missing is `null`, not zero. Today there were none.
- **500 errors:** the docs and earlier experience report intermittent 500s. Three repeated requests on October 25 all returned 200. Keep the plan to retry once with backoff, then serve stale cache.
- **Rate limits** are not published. Caching per `ARCHITECTURE.md` keeps us well clear.

---

## Sunrise and sunset

Computed locally with the `suncalc` library. No external API.

---

## Not used: Weather Underground

Some clubs point members to Weather Underground's hourly forecast pages. We use the NWS API instead, which is free and covers the same forecast data. Users may still compare against it, so expect occasional differences between forecast providers.

---

## Later: Open-Meteo (global weather and modeled river discharge)

- **Docs:** https://open-meteo.com/en/docs and https://open-meteo.com/en/docs/flood-api
- **Weather:** global forecasts, a fallback outside the US.
- **Flood API:** simulated daily river discharge from GloFAS at about 5 km resolution, with history back to 1984 and forecasts. Returns the largest river within roughly 5 km, so it can select the wrong river. Useful for trends, never a substitute for a real gauge, and must be labeled as modeled in the UI.
- **Licensing:** free for non-commercial use; commercial use requires an API key and plan. A paid product counts as commercial. Check terms before shipping.

## Later: UK Environment Agency flood monitoring API

- Used by Thames clubs for flow and river status (see `DOMAIN.md`). Public API; document endpoints here when the UK adapter is started.

## Later: tides

Needed for tidal rivers (UK expansion, some US rivers). Source TBD.
