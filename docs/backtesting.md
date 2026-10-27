# Backtesting

M9 replays remembered days from past seasons to see whether the app's view matches what crews remember. This page covers recording a case. Replaying one is #108. Cases and findings get added here as they're reviewed (#37).

## Recording a case

```
pnpm fixtures:record-case --name may-15-high-water --date 2026-05-15 \
  --lat 42.6 --lon -72.55 --gauge USGS-01170500 --gauge USGS-01161280 --station KORE
```

- `--name`: kebab-case. Fixtures go in `apps/api/test/fixtures/cases/<name>/`.
- `--date`: the day being replayed, `YYYY-MM-DD`. It must be January 1, 2024 or later, because that's where Open-Meteo's forecast archive starts. It must also be at least three days ago, so the whole window has data.
- `--lat`, `--lon`: the location. A negative value can follow the option directly (`--lon -72.55`).
- `--gauge`: one or more USGS monitoring location IDs.
- `--station`: the airport station for observed weather, such as `KORE` (Orange, MA). Use the station the app shows under current weather for the location. Leave it out only when no station is within 30 km. The script then records modeled history instead.

The script uses the live network, so run it by hand only. Never run it in tests, the pre-push check, or CI. It spaces its requests one second apart and sends no API key.

## What a case contains

The window covers four UTC days: the day before the date, for recent trends, through two days after it, for the 48 hours ahead of a morning on the date.

| File | Source | What it is |
|---|---|---|
| `usgs-<site>-flow`, `-gauge-height`, `-water-temp` | USGS `continuous` | Measured readings for each gauge, in the API's units. |
| `open-meteo-previous-runs` | Open-Meteo Previous Runs API, NBM model | Hourly forecasts as they stood one day (`_previous_day1`) and two days (`_previous_day2`) before each hour. |
| `iem-asos-<station>` | IEM ASOS archive | Routine hourly reports from the station, as CSV. Wind is in knots. |
| `open-meteo-archive` | Open-Meteo Historical Weather API | Modeled history. Recorded only when there's no `--station`. |
| `case.json` | | The arguments, the window, and when the case was recorded. |

Each fixture is `{ url, recordedAt, status, body }`, like every other fixture.

When a response has no readings, the script lists it after recording. It's not a failure. A gauge may not report that metric, or its sensor may have been out. On May 15, 2026, Northfield (USGS-01161280) had no water temperature, though it reported one from July on. A replay shows missing data as unknown.

A case with two gauges is about 1 MB. Gauges that report every five minutes are the largest part.

## Limits

- **Weather forecasts are model forecasts, not the NWS forecasts as issued.** NWS forecasters edit the NBM, so a crew that checked the forecast that morning may have seen something different (decision 0019).
- **Flow forecasts can't be replayed.** NWPS keeps no past forecasts. A replay can show measured flow only, unless forecasts are recorded as they're made (#81).
- **IEM data has little quality control.** Missing values, values that failed a check, and values never reported all look the same, and all are unknown.

## Attribution

- Weather forecasts and modeled history: [Open-Meteo](https://open-meteo.com/), data under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Free for non-commercial use.
- Station observations: the [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/) of Iowa State University.
- River readings: [USGS Water Data APIs](https://api.waterdata.usgs.gov/).
