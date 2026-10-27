# Backtesting

M9 replays remembered days from past seasons to see whether the app's view matches what crews remember. This page covers recording and replaying a case. Cases and findings get added here as they're reviewed (#37).

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
| `iem-asos-<station>` | IEM ASOS archive | Routine hourly reports from the station, with its position, as CSV. Wind is in knots. |
| `open-meteo-archive` | Open-Meteo Historical Weather API | Modeled history. Recorded only when there's no `--station`. |
| `case.json` | | The arguments, the window, and when the case was recorded. |

Each fixture is `{ url, recordedAt, status, body }`, like every other fixture.

When a response has no readings, the script lists it after recording. It's not a failure. A gauge may not report that metric, or its sensor may have been out. On May 15, 2026, Northfield (USGS-01161280) had no water temperature, though it reported one from July on. A replay shows missing data as unknown.

A case with two gauges is about 1 MB. Gauges that report every five minutes are the largest part.

## Replaying a case

```
pnpm fixtures:replay-case --name may-15-high-water --at 2026-05-15T06:00 \
  --timezone America/New_York --rule-set ~/my-club.json
```

- `--at`: the local time to replay, `YYYY-MM-DDTHH:MM`. It must fall between the start of the window and 48 hours before its end, so from the day before the date through midnight UTC after it.
- `--timezone`: the location's IANA time zone, for reading `--at` and showing times.
- `--rule-set`: a file with one rule set as JSON, in the app's own format (`RuleSet` in `packages/core/src/types/rules.ts`, values in SI). To copy one from the web app, run `copy(JSON.parse(localStorage['rowing-conditions:rule-sets']).data[0])` in the browser console, paste it into a file, and change the index for another rule set.
- `--boat-class`: a boat class ID from the rule set. Defaults to its first.
- `--units`: `us` (default) or `metric`.

The replay reads only the case's fixtures and makes no network calls. It prints one row per hour for the 48 hours from `--at`. Each row has the status against the rule set (within, outside or unknown), what was outside or unknown and why, and the values the app would have shown. Beside those it puts what the station reported in that hour, or modeled history when the case has no station.

How a replay stands in for the live sources:

- **Hours** are built by the app's own `getConditions`, and evaluated by `evaluateTimeline` as the web app does. The case's fixtures sit behind the same source interfaces.
- **River:** the latest USGS reading of each metric at or before `--at` applies to every hour, as the app does for a gauge without a forecast. Nothing measured after `--at` is used.
- **Weather forecast:** for each hour, the latest forecast the app could have had at `--at`. That's the one made a day before the hour for the first 24 hours, and the one made two days before for the rest (the Lead column). Forecasts are dated an hour before `--at`, about how often NWS updates its grids. A forecast value is never too old in a replay. A station report newer than that replaces the forecast in the current hour, as in the app.
- **Current weather:** the station's latest report at or before `--at`, if it's within 30 km and 2 hours old, as in the app. Otherwise the forecast's current hour.
- **Gauge names** aren't recorded, so the gauge ID stands in.

The `replay-test` case and the `test-club` rule set in the fixtures are for tests only. The rule set's limits are made up.

## Limits

- **Weather forecasts are model forecasts, not the NWS forecasts as issued.** NWS forecasters edit the NBM, so a crew that checked the forecast that morning may have seen something different (decision 0019).
- **Flow forecasts can't be replayed.** NWPS keeps no past forecasts. A replay can show measured flow only, unless forecasts are recorded as they're made (#81).
- **Alerts aren't recorded,** so a replay shows none.
- **Maximum ages can only be checked for measurements.** Replayed forecasts are always recent, so forecast maximum ages never apply.
- **IEM data has little quality control.** Missing values, values that failed a check, and values never reported all look the same, and all are unknown.

## Attribution

- Weather forecasts and modeled history: [Open-Meteo](https://open-meteo.com/), data under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Free for non-commercial use.
- Station observations: the [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/) of Iowa State University.
- River readings: [USGS Water Data APIs](https://api.waterdata.usgs.gov/).
