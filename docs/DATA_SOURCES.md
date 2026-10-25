# Data Sources

Status: Draft v0.2, details as of October 2026.

**Before implementing or changing any adapter, verify the details below against the source's official documentation.** APIs change (USGS is mid-migration as of this writing). If the docs differ from this file, follow the docs and update this file in the same change.

General rules for all adapters are in `ARCHITECTURE.md` (Zod parsing, SI conversion, timeouts, caching).

---

## USGS Water Data APIs (US flow, gauge height, water temperature)

- **Docs:** https://api.waterdata.usgs.gov/docs/ (OpenAPI with query builder)
- **Base URL:** `https://api.waterdata.usgs.gov/ogcapi/v1`
- **Do not use** the legacy WaterServices API (`waterservices.usgs.gov`). It is being decommissioned: degradation from November 16, 2026, full retirement in early 2027. Many tutorials and code samples online still use it, and some examples use the earlier `v0` path. Use `v1`.
- **Auth:** none required. Optional API key (sign up at https://api.waterdata.usgs.gov/signup/) for higher rate limits, sent as `X-Api-Key` header or `api_key` query parameter. Read from `USGS_API_KEY` env var if present.
- **Format:** OGC API Features. Add `f=json` to get JSON (browsers default to HTML). Responses are GeoJSON with records under `features`.

### Collections we use

| Collection | Use |
|---|---|
| `monitoring-locations` | Gauge metadata and nearby search (by bounding box) |
| `latest-continuous` | Most recent reading per time series at a gauge |
| `continuous` | Historical readings (backtesting, trends) |
| `time-series-metadata` | Which parameters a gauge actually reports |
| `parameter-codes` | Reference for parameter codes |

### Identifiers and parameters

- Monitoring location IDs combine agency and number: `USGS-01170500`.
- Parameter codes we care about (verify in `parameter-codes`):
  - `00060` discharge, ft³/s → convert to m³/s
  - `00065` gauge height, ft → convert to m
  - `00010` water temperature, °C
- Filter with `monitoring_location_id` and `parameter_code` (both accept comma-separated lists). Use `skipGeometry=true` when coordinates are not needed.

### Quirks

- Readings are typically every 15 minutes, but telemetry delays vary by gauge; some gauges lag by hours.
- Recent data is **provisional** and can be revised. Preserve qualifiers.
- In winter, gauges may report ice-affected values or none at all. Treat ice-affected discharge as unreliable and surface the qualifier in the UI.
- Many gauges do not report water temperature. Check `time-series-metadata` rather than assuming.
- Trend (rising/falling) needs recent history from `continuous`, not just `latest-continuous`.

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

- **Docs:** https://www.weather.gov/documentation/services-web-api
- **Base URL:** `https://api.weather.gov`
- **Auth:** none. A `User-Agent` header identifying the app and a contact email is **required**; requests without it may be blocked. Read from `NWS_USER_AGENT`.
- **Coverage:** US only.

### Flow

1. `GET /points/{lat},{lon}` (max 4 decimal places) returns the forecast office, grid coordinates, and URLs for `forecastHourly` and `forecastGridData`. The mapping from point to grid rarely changes: cache for 30 days.
2. `GET /gridpoints/{office}/{x},{y}` (the `forecastGridData` URL) returns raw time series: `temperature`, `windSpeed`, `windGust`, `windDirection`, `probabilityOfPrecipitation`, and more. Prefer this over `forecastHourly`, which returns pre-formatted strings.
3. `GET /alerts/active?point={lat},{lon}` returns active alerts.

### Quirks

- Grid data values use ISO 8601 intervals (`validTime: "2026-10-24T14:00:00+00:00/PT3H"`), meaning one value can span several hours. Expand to hourly points.
- Units are given as WMO codes (for example `wmoUnit:degC`, `wmoUnit:km_h-1`). Convert based on the stated unit, never assume.
- `windGust` is often missing for some hours. Missing is `null`, not zero.
- The API returns intermittent 500 errors. Retry once with backoff, then serve stale cache.
- Rate limits are not precisely published. Caching per `ARCHITECTURE.md` keeps us well clear.

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
