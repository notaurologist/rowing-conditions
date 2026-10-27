# Backtesting

M9 replays notable days picked from last season's data, such as high water, cold mornings, windy days, and gaps in gauge or station data. Each replay shows what the app would have shown that morning, next to what was measured that day. This page covers recording and replaying a case. Cases and findings get added here as they're reviewed (#37).

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

The Measured column is the status the same limits give with the values measured in each hour: the station report filed in the hour and the gauge's last reading in it. Below the table, the replay lists the hours where the measured status differs from what the app showed. Limits on chance of rain are left out of the measured status, since nothing measures it, and the replay says so. Modeled history is never treated as measured.

How a replay stands in for the live sources:

- **Hours** are built by the app's own `getConditions`, and evaluated by `evaluateTimeline` as the web app does. The case's fixtures sit behind the same source interfaces.
- **River:** the latest USGS reading of each metric at or before `--at` applies to the hours starting within 3 hours of it, as the app does for a gauge without a forecast; later hours are unknown. Nothing measured after `--at` is used.
- **Weather forecast:** for each hour, the latest forecast the app could have had at `--at`. That's the one made a day before the hour for the first 24 hours, and the one made two days before for the rest (the Lead column). Forecasts are dated an hour before `--at`, about how often NWS updates its grids. A forecast value is never too old in a replay. A station report newer than that replaces the forecast in the current hour, as in the app.
- **Current weather:** the station's latest report at or before `--at`, if it's within 30 km and 2 hours old, as in the app. Otherwise the forecast's current hour.
- **Gauge names** aren't recorded, so the gauge ID stands in.

The `replay-test` case and the `test-club` rule set in the fixtures are for tests only. The rule set's limits are made up.

## Cases

Notable days from April to October 2026 at Turners Falls (42.6, -72.55), picked from the data (#37). All use Orange airport (KORE), 21.7 km away, for observed weather.

| Case | Picked because | Gauges |
|---|---|---|
| `high-water-2026-04-02` | Montague's highest daily mean flow of the season, 46,300 cfs | Montague |
| `windy-2026-05-05` | Sustained wind of 23 mph and gusts to 43 mph at KORE in daylight | Montague |
| `data-gap-2026-06-09` | KORE filed 4 of its 14 daylight reports; Montague reported every 2 hours instead of every 15 minutes on June 7 and 8 | Montague |
| `forecast-miss-2026-06-30` | The season's largest daylight temperature miss: KORE measured 18 °F below the day-ahead forecast | Montague |
| `cold-2026-10-24` | −4.4 °C air between 5 and 8 a.m., with water at Northfield near 11 °C, so the combined air and water limit applies | Northfield (shown, water temperature), Montague |

How they were picked: USGS daily mean flow at Montague and continuous water temperature at Northfield; KORE's routine hourly reports from IEM; and the NBM day-ahead forecast from Open-Meteo's Previous Runs API, compared with KORE hour by hour from 6 a.m. to 8 p.m. EDT.

These cases aren't in the repo. Together they're about 3 MB of fixtures, and no test uses them. To re-record one, run its command below, then replay it at 6 a.m. with your rule set:

```
pnpm fixtures:record-case --name high-water-2026-04-02 --date 2026-04-02 --lat 42.6 --lon -72.55 --gauge USGS-01170500 --station KORE
pnpm fixtures:record-case --name windy-2026-05-05 --date 2026-05-05 --lat 42.6 --lon -72.55 --gauge USGS-01170500 --station KORE
pnpm fixtures:record-case --name data-gap-2026-06-09 --date 2026-06-09 --lat 42.6 --lon -72.55 --gauge USGS-01170500 --station KORE
pnpm fixtures:record-case --name forecast-miss-2026-06-30 --date 2026-06-30 --lat 42.6 --lon -72.55 --gauge USGS-01170500 --station KORE
pnpm fixtures:record-case --name cold-2026-10-24 --date 2026-10-24 --lat 42.6 --lon -72.55 --gauge USGS-01161280 --gauge USGS-01170500 --station KORE

pnpm fixtures:replay-case --name windy-2026-05-05 --at 2026-05-05T06:00 --timezone America/New_York --rule-set ~/my-club.json
```

The findings below come from recordings made on October 27, 2026. USGS readings from the last several months are provisional and can be revised when they're approved, so a later recording may differ slightly. Don't commit the recordings.

## Findings, October 2026

Each case was replayed at 6 a.m. EDT on its date against the owner's club's only limit: flow at most 20 kcfs at Montague, measured at the same gauge the club watches (NWPS `MNTM3` shows USGS 01170500's readings). The club has no wind, temperature or daylight limits; it asks rowers to check the weather themselves. So the statuses below are about flow, and the weather comparisons are context.

| Case | App at 6 a.m. | Measured status differs | What the replay showed |
|---|---|---|---|
| `high-water-2026-04-02` | Outside all 48 hours (45.5 kcfs) | Never | Flow stayed well over the limit for both days. |
| `windy-2026-05-05` | Within all 48 hours (11.7 kcfs) | 2 hours, 2–3 a.m. the next night | A release took Montague from 15.3 to 21.7 kcfs in about 2 hours. Forecast wind was 5–9 mph under what Orange measured from 11 a.m., and gusts up to 18 mph under (25 mph forecast, 43 mph measured at 2 p.m.). |
| `data-gap-2026-06-09` | Within all 48 hours (7.5 kcfs) | 2 hours, 9–10 p.m. | Orange's reports stopped, so current weather fell back to the forecast, labeled as such. A release took Montague from 14.8 to 23.4 kcfs within 2 hours. |
| `forecast-miss-2026-06-30` | Within all 48 hours (5.3 kcfs) | 2 hours, 7–8 p.m. the next day | The day-ahead forecast had 90 °F all afternoon; Orange measured 72 °F at 3 p.m. after a sudden drop, with a 9–13% chance of rain forecast. Flow later crossed 20 kcfs briefly. |
| `cold-2026-10-24` | Within all 48 hours (4.7 kcfs) | Never | Air at Orange was 24 °F at 6 a.m. and water at Northfield 53 °F. The air forecast was within 7 °F of what was measured until 4 p.m., then up to 10 °F too warm as it cooled. |

What this means for the app:

- **Flow changes faster than the app assumed.** Across April to October 2026, on 10 days Montague was within 20 kcfs at 6 a.m. and over it later the same day, once from 3.5 kcfs. The largest one-hour rise was 6,900 cfs. These are releases from the dams upstream: sharp rises over an hour or two, then slower falls.
- **Maximum age for flow and gauge height readings lowered from 6 to 3 hours.** A 6-hour-old reading could be off by more than 15,000 cfs. Montague never went more than 2 hours between readings all season (every 2 hours on June 7 and 8, otherwise every 15 minutes), so 3 hours wouldn't have marked any reading stale.
- **Without a flow forecast, the latest reading is held for 48 hours.** That's how the replays work, and how the app works for a gauge without an NWPS forecast. It missed every one of these releases. For Montague, the app uses the NWPS forecast instead, but whether NWPS anticipates releases can't be checked from history, since NWPS keeps no past forecasts (#81). #82 found the NWPS forecast at `MNTM3` disagreeing with the gauge by about half. What to do about held readings is #117. Since #117 and #82 (October 2026), a reading stands in for 3 hours only, and a forecast more than 25% off the latest reading is set aside.
- **Wind on windy days was under-forecast.** On May 5 the day-ahead forecast had the wind's shape right but not its size. For limits on wind, the measured values from the station in the current hour matter.
- **Northfield reports negative flow.** USGS 01161280 had 50 negative readings from October 23 to 26 (down to −4,890 cfs) and 189 in July, probably from the Northfield Mountain pumped storage station and the Turners Falls dam pool. The app treats negative flow as out of range, so those readings are missing (#116).
- **Stale data and gaps behaved as designed.** Missing weather reports fell back to the forecast and said so, and Montague's 2-hourly readings stayed current.

Headroom scales: reviewed and unchanged. Flow's scale is the limit itself, and 20 kcfs is the only limit in this rule set. A release can use up about a third of that in an hour, so headroom says little about the next few hours on this river. The fixed temperature and gauge height scales couldn't be checked, since the club has no limits on them.

## Archived NWPS forecasts

Since #81 (October 2026) the API keeps each NWPS flow forecast it fetches, for 90 days, in `forecast_archive`. Only forecasts fetched while someone viewed a location are there, so the record has gaps. To compare a forecast with what was measured, read it from the database and the measurements from USGS history:

```sql
select issued_at, p->>'time' as hour, (p->'values'->>'flow')::float * 35.3147 as flow_cfs
from forecast_archive, jsonb_array_elements(points) as p
where ref = 'MNTM3' and issued_at between '2026-10-27' and '2026-10-28'
order by issued_at, hour;
```

`createForecastArchive(...).issuedBetween(ref, from, to)` returns the same rows to code. Replays don't use the archive yet.

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
