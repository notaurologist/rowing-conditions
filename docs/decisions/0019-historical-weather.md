# 0019: Historical weather for backtesting from Open-Meteo and the IEM ASOS archive

Status: Proposed (October 2026)

## Context
M9 replays remembered days from last season to see whether the app's view matches what crews remember (issue #35). Flow and water temperature come from USGS `continuous` data. Weather needs another source:

- The NWS API keeps no past forecasts, and station observations go back only about a week.
- A replay needs two things: **what the app would have shown**, a forecast made a day or two ahead, and **what happened**.
- The app's metrics are air temperature, wind speed, gusts, direction, and chance of rain.

Checked October 26, 2026 against each provider's docs and live requests for Turners Falls on May 15, 2026:

| Option | What it gives | Terms | Fit |
|---|---|---|---|
| Open-Meteo Previous Runs API | Forecasts as they stood 1 to 7 days before each hour (`_previous_day1`, `_previous_day2`, …). Archived from January 2024 for most models. Includes NCEP NBM CONUS, HRRR, and GFS. The live request returned hourly temperature, wind speed, gusts, direction, and chance of rain for each. | Free for non-commercial use; under 10,000 calls a day; data under CC BY 4.0. No key. | Chosen for forecasts. |
| Open-Meteo Historical Weather API | Gridded history: ERA5 (about 25 km, 5-day delay), ERA5-Land, ECMWF IFS (9 km). Includes gusts. | As above. | Kept as a fallback where no station is near. Modeled, not measured. |
| Iowa Environmental Mesonet (IEM) ASOS archive | METAR observations from airport stations, including Orange (`ORE`, the station the app uses near Turners Falls), with 2026 data present. | Public domain; attribution appreciated. As-is: very little quality control. | Chosen for what happened. |
| NCEI Global Hourly (ISD) | The same airport observations, from NOAA. | Public domain. | Rejected for now: KORE's record ends August 2025, and 2026 requests returned nothing. Fields are packed ISD codes. |
| NWS NDFD archive at NCEI | The NWS forecasts as actually issued. | Public domain. | Rejected for now: GRIB2 files need a decoding library. Worth revisiting if model forecasts turn out to differ too much from NWS ones. |

## Decision
- **Forecasts:** the Open-Meteo Previous Runs API with `models=ncep_nbm_conus`, which is the National Blend of Models that NWS grids start from.
  - Hourly `temperature_2m`, `wind_speed_10m`, `wind_gusts_10m`, `wind_direction_10m`, and `precipitation_probability`, each with `_previous_day1` (a day ahead) and `_previous_day2` (two days ahead).
  - Request with `wind_speed_unit=ms` and `timezone=GMT`.
- **Observations:** the IEM ASOS download service for the station the app would have used for current weather.
  - Fields: `tmpc`, `sknt` (knots, converted to m/s in the adapter), `gust`, and `drct`.
  - Routine hourly reports, in UTC.
- **Fallback:** the Open-Meteo Historical Weather API where no station is within 30 km, labeled as modeled.
- **Backtesting only.** These sources feed the fixture recorder (#36) and the replays (#37), never the live app. Adapters parse with Zod and convert to SI, as for every source.
- **No new dependency.** Plain `fetch`, as the other adapters do.
- **Attribution:** `docs/backtesting.md` credits Open-Meteo (CC BY 4.0) and the IEM.

## Consequences
- **A replayed forecast is a model forecast, not the NWS forecast as issued.** NWS forecasters edit the NBM, so differences between a replay and what a crew saw that morning may come from the source rather than the app. Backtesting notes should keep the two apart.
- **Missing values stay unknown.** IEM data has little quality control, and its `M` can mean missing, failed a check, or never reported. Every case is treated as unknown, never as within limits.
- **Free use.** Open-Meteo's free tier is non-commercial. Backtesting makes a few calls per case, far below the limits. If the app ever becomes commercial, this use needs a paid plan or another source (0015).
- **Not verified:**
  - In the sample, chance of rain was 14% from NBM, HRRR, and GFS alike. How Open-Meteo derives chance of rain for each model isn't documented on the pages checked.
  - IEM states no rate limits. The recorder should still space its requests.
