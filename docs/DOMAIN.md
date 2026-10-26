# Domain Knowledge

Status: Draft v0.2

This document explains the rowing domain for anyone (human or agent) working on this project: which conditions matter, how clubs turn them into rules, and what that means for the data model. Every factual claim should trace to a source in the "Sources" section. If you add domain knowledge, add its source.

Important: this document describes how rowing organizations and clubs approach conditions. It is not safety guidance, and nothing here should be presented to users as a recommendation. See the core principle in `PRODUCT.md`.

## What official bodies publish

- **USRowing** publishes safety guidelines, a safety audit checklist, and a safety video. Its guidance is mostly qualitative: it names unsafe conditions (high wind, fog, thunder and lightning, strong current, debris, high waves, extreme cold, extreme heat) and recommends boats with four oars on cold water for stability. [1][2]
- USRowing formerly recommended a combined air plus water temperature minimum of 90°F. Many clubs still use it. USRowing's Director of Safeguarding has written that it is a reasonable starting point but underweights the much greater danger of cold water compared to cold air. [3]
- **British Rowing** publishes RowSafe, its safety guide. It asks each club to set its own criteria for cancelling outings in a risk assessment, covering flow rates, wind speed and direction, and local hazards such as weirs. [4]
- Neither body, as far as we found, publishes datasets or APIs. Numeric limits live in individual club policies.

Takeaway: there is no universal standard to encode. The app must let users and clubs define their own rules.

## Conditions that matter

### Water temperature

The most important temperature factor. Cold water is far more dangerous than cold air, and clubs set hard minimums on water temperature specifically. [3][5] Some USGS gauges report water temperature; many do not.

### Air temperature and wind chill

Used alone (minimum air temperature) and in combination with water temperature. Some clubs also set a wind chill minimum. [5][6][9]

### Combined air plus water temperature

A sum of air and water temperature in °F, compared against a minimum. Common values are 90°F for small boats and lower (for example 80°F) for boats with four or more oars. [3][7] Note: this is defined in Fahrenheit. A sum in Celsius is not equivalent, so the app must compute it in °F regardless of display units.

### Wind

Speed, gusts, and direction. Clubs commonly cap wind for small boats (15 mph appears in multiple policies). [7][8] Direction matters on rivers: wind blowing against the current makes water rougher, and at least one club caps sustained wind in that direction specifically. [10] British Rowing notes wind adds to flow risk. [4][11]

### Flow (discharge) and gauge height

The main river hazard. Fast water increases turbulence (often below the surface), makes hazards like bridges, trees and moored boats more dangerous, and makes steering harder. [11][12] Clubs tie flow limits to a specific named gauge, not just "the river." [8][10] Trend matters too: flow can change during a day. [13]

### Dam operations and low water

On regulated rivers, dam releases can raise flow quickly, and drawdowns can leave water too shallow to row (locally on the Connecticut, sometimes nearly walkable). Observed flow and gauge height capture these once they happen, so a minimum flow or gauge height limit flags low water. Advance release schedules are published inconsistently by dam operators (web pages, phone lines, rarely APIs), so they are out of scope for the MVP. Source: member experience on the Connecticut River [19].

### Daylight and visibility

Clubs restrict outings to daylight or to a window around it (for example, 60 minutes before sunrise to 30 minutes after sunset), and require lights in low light. Fog is called out as a hazard. [2][7][8] In practice, many crews push off before sunrise and row with lights, and do the same in fog, so light is often one factor among several, not a cutoff. [19]

### Lightning

Boats leave the water when lightning is within a set distance (15 miles in one policy). [7]

### Ice

Clubs prohibit outings when ice is present, sometimes with specific criteria. [8][14]

### Tides (tidal rivers only)

On tidal water, an ebbing tide adds to river flow and a flooding tide counteracts it, so actual stream speed depends on both. [11][15] Out of scope for the MVP, but relevant for UK expansion.

### Other factors outside our data

Crew experience, cox competence, launch coverage, other river traffic, debris, and local hazards. [12] The app cannot see these, which is one reason it reports conditions rather than verdicts.

## How clubs structure rules

Real policies combine these patterns:

1. **Simple limits:** a single metric against a min or max. Example: no boats if water is below 39°F. [5]
2. **Combined metrics:** air plus water temperature against a minimum. [5][7]
3. **Rules by boat class:** different limits for singles and pairs vs. boats with four or more oars. Nearly universal. [5][7][8]
4. **Gauge-specific limits:** flow limits measured at a named gauge. [8][10]
5. **Time windows:** permitted hours relative to sunrise and sunset. [8]
6. **Banded zones:** ranges of a metric map to levels with different requirements. Example: Pittsburgh maps flow bands (in cfs) to launch-to-shell ratios and coach certification levels, uses the more restrictive of the flow and temperature zones, and relaxes one zone in daylight. [10] UK clubs use similar risk levels and color statuses. [13][15]
7. **Directional conditions:** wind limits that apply only when blowing against the current. [10]

### Example policies

| Club | Rules (summarized) | Source |
|---|---|---|
| Albany Rowing Center (NY) | Water at least 39°F to launch anything. Water at or below 50°F: only doubles, quads, fours, eights. Singles and pairs need water above 50°F and air plus water at least 90°F. Below 40°F air or 50°F water, boats stay within 100 yards of a launch. | [5] |
| Des Moines Rowing Club (IA) | Rowing allowed 60 min before sunrise to 30 min after sunset if other conditions are met, with a bow light in low light. No rowing on club equipment when air plus water is below 100°F; eights in cold weather need air over 36°F and wind under 10 mph. Dock closed above 13,000 cfs and experienced crews only from 10,000 to 12,999 cfs, at the Des Moines River at 2nd Avenue gauge (USGS 05482000). No club singles at 15 mph wind; less experienced scullers not above 10 mph. | [8] |
| Indianapolis Rowing Center (IN) | Off the water if lightning within 15 miles. Small boats advised not to row over 15 mph wind. Combined minimum 90°F small boats, 80°F for 4+ oars. Sunrise to sunset unless lit. | [7] |
| Pittsburgh Rowing Club (PA) | Six flow zones, from under 28,000 cfs to 50,000–60,000 cfs, determine launch ratios and coach certification; the page shows flow from the Ohio River at Sewickley gauge (USGS 03086000). Use the more restrictive of flow and temperature zones. Daylight relaxes one zone, except the highest. In the highest zone, max 8 mph sustained wind against the current. | [10] |
| Utah Crew (UT) | No boats if wind chill below 25°F. Restrictions when combined temperature below 90°F. No boats on the main course if water below 40°F. | [6] |
| A Connecticut River club (MA) | Club boats only when flow is at or below 20 kcfs at the Montague gauge (NWS ID MNTM3). Members check the NWS hydrograph (3 days observed, 3 days forecast) and an hourly weather forecast before going out. | [19] |
| Cantabs (Cambridge, UK) | Avoid boating with ice on the river, with a specific ice thickness cutoff. Follows RowSafe. | [14] |

The rule set editor shows a few of these, checked against their sources in October 2026, under "How some clubs word their limits" (`packages/core/src/rules/examples.ts`). They are shown, never prefilled or applied, so none becomes a default (decision 0001). Rows whose source couldn't be read or isn't public are left out.

### What local practice adds

- **Clubs use flow forecasts, not just observations.** The NWS hydrograph pages clubs link to show a multi-day flow forecast for gauges where a River Forecast Center issues one. [19][20]
- **Flow is often discussed in kcfs** (thousands of cubic feet per second). [19]
- **Rules are per club, and fleets differ.** Rowers may row with more than one club on the same stretch of river. One club may have nothing larger than a double while another runs eights, so boat classes are club-specific, not a universal small/large split. [19]

## Implications for the data model

- Limits are grouped into **rule sets** (usually one per club). Each rule set has a name, its own user-defined boat classes, its own limits, an optional daylight window, and an optional named flow gauge.
- A limit needs: a metric, a comparison (min or max), whether the limit value itself counts as within, a value with explicit units, the unit the user entered it in, and an optional list of boat classes it applies to (none = all).
- Combined air plus water temperature is its own computed metric, always in °F.
- A rule set may reference a specific gauge, not just the nearest one.
- Flow for each forecast hour comes from the NWPS forecast when available, otherwise from the latest observation, and the source must be visible.
- Daylight windows are offsets from sunrise and sunset.
- **MVP supports patterns 1 through 5.** Banded zones (6) and directional conditions (7) come later, but the threshold model should be extensible enough to add them without a rewrite.
- Requirements like launch ratios and coach certification are operational, not conditions. Out of scope.

## How the app applies limits

Club policies are written for people reading a thermometer or a gauge page, so they leave details open that software has to settle. These are the conventions the app uses. The exact rules and constants are in `ARCHITECTURE.md` under "Evaluation."

### A value exactly at the limit

Policies go both ways. "Flow at or below 20 kcfs" [19] and "water at least 39°F" [5] include the limit. "No club singles at 15 mph wind" [8] excludes it. So each limit records which it is, and the rule set editor shows it in words: "at most 15 mph" or "below 15 mph," "at least 39°F" or "above 39°F." The editor preselects the inclusive wording because most policies we found read that way, and the user can change it.

### Comparing what the user sees

A limit entered as 15 mph is compared in mph, rounded to the precision the app displays, not as an unrounded SI value. Otherwise a forecast of 24 km/h (14.9 mph) displays as "15 mph" but is treated as below 15 mph, and the user sees a result that contradicts the number on screen. Values are still stored in SI; the comparison converts both the reading and the limit to the unit the limit was entered in, then rounds both.

Combined air plus water temperature is the sum of the two readings each rounded to a whole °F, so it matches what a rower adds up from the displayed numbers.

### Old readings

A reading that is too old is treated as missing, so the hour shows as unknown, not within. The latest flow observation is carried across all 48 hours when there is no forecast. That is only reasonable while the observation is recent. Gauges lag or go offline, especially in winter.

Starting values (to be tuned during backtesting, M9):

- Flow and gauge height observations: older than 6 hours is stale. Flow can change substantially within a day [13].
- Water temperature observations: older than 24 hours is stale. Water temperature changes slowly.
- NWPS flow forecasts: an issue time older than 36 hours is stale. River Forecast Centers usually issue at least daily.
- NWS weather forecasts: an update time older than 12 hours is stale.

Hours past the end of a flow forecast are unknown for flow. The app does not fall back to the latest observation there, because that would contradict the trend the forecast just showed.

### Measured now beats forecast for now

For the current hour, a real measurement replaces the forecast: the gauge's latest flow, gauge height and water temperature, and the nearby weather station's air temperature and wind. On October 26, 2026 the gauge at Montague measured 7,440 cfs while a 22-hour-old forecast still said 3,183 for that hour, and the app showed a window that the river had already closed. Later hours keep the forecast, because a measurement says nothing directly about them. The summary says in plain numbers when the latest reading and the forecast for its hour disagree by more than 10%, so a forecast that has drifted is visible. Two limits:

- **Recency:** only a measurement taken in the current hour or the one before counts. An older reading served from a cache doesn't stand in for now.
- **Newer forecasts win:** a forecast issued after the measurement keeps its value.

(Decided in issue #75, October 2026.)

### Flagged readings

USGS marks recent data as provisional. That is normal and does not affect evaluation. Some qualifiers mean the value itself is unreliable: ice-affected discharge, equipment malfunction, and estimated values. Estimated values are common during ice periods. Those readings are shown with their qualifier, but evaluation treats them as unknown. While a gauge reports estimates, a flow limit can stay unknown for weeks in winter; revisit this during backtesting (M9) if that turns out to hide too much. (Decided in issue #41, October 2026.)

USGS also flags maintenance, flood damage, backwater, a rating still being developed, debris, dam failure, test data, and values below what's shown ("less than", "below minimum"). These count as unreliable too, and so does any code the app doesn't recognize, so a new USGS code can never let a doubtful value through. Only codes known to be informational, such as "discontinued" or "regulated", are ignored. A "less than" value matters most for low-water minimums: the true flow is lower than the number shown. The full code table is in `DATA_SOURCES.md`. (Decided in issue #13, October 2026.)

### Limits the location cannot check

A limit can only be checked if some source reports its metric at that location. For example, a gauge without a water temperature sensor cannot check a water temperature minimum, and a lake in weather-only mode cannot check flow. Every hour is then unknown for that rule set. That is correct: a missing reading is never treated as passing. But the app says so once, in plain words ("Club A's water temperature limit can't be checked here: this gauge doesn't report water temperature"), instead of only showing 48 unknown hours.

### Light

For many crews, light is a factor to weigh, not a cutoff. Crews often push off before sunrise and row with lights, and they do the same in fog [19]. Some clubs do write a hard window (Des Moines: 60 minutes before sunrise to 30 minutes after sunset [8]), but others make it conditional ("sunrise to sunset unless lit" [7]).

So the app treats light as context by default:

- Every hour is labeled with its light level: daylight, twilight (civil twilight, between civil dawn and sunrise or between sunset and civil dusk), or dark. The chart shades each level differently, and the label is shown in words, not shading alone. These are descriptions, never instructions: the app says "before sunrise (twilight)," not "lights required."
- Light level does not change whether an hour is within a rule set's limits.
- A rule set's daylight window is optional and meant only for clubs with a hard rule. If one is set, hours entirely outside it are outside that rule set's limits, with darkness given as the reason, and windows that start or end partway through an hour are cut at the exact boundary. The editor describes it that way ("only if your club forbids rowing outside these hours").
- When the app needs a default span of "hours you might row" (choosing which metric to chart, listing periods within limits), it uses civil dawn to civil dusk, or the rule set's window if it has one. This keeps cold, calm overnight hours from deciding the default chart while still including pre-sunrise outings in twilight.

Open question: fog and visibility. The NWS grid data includes visibility and a weather layer that reports fog. Showing visibility as context, and allowing an optional minimum-visibility limit, would treat fog the same way as light. That would expand the MVP, so it is not in the plan yet.

## Units

- Store everything in SI: m³/s (flow), m (gauge height), °C (temperature), m/s (wind), with conversion for display.
- US users expect cfs (often kcfs for large rivers), ft, °F, and mph. UK clubs use m³/s and °C. [13][19]
- Exception: combined air plus water temperature is computed in °F (see above).
- Comparisons against a limit happen in the limit's entered unit at display precision (see "Comparing what the user sees").

## Data sources (summary)

Details belong in `DATA_SOURCES.md`.

- **US:** USGS Water Data APIs, v1 at `api.waterdata.usgs.gov/ogcapi/v1` (flow, gauge height, some water temperature), and the National Weather Service API (forecasts, alerts). Do not use the legacy WaterServices APIs (`waterservices.usgs.gov`): USGS is decommissioning them, with degradation starting November 2026 and full retirement in early 2027. [18]
- **US flow forecasts:** NOAA National Water Prediction Service (NWPS) API, observed and forecast stage and flow for NWS forecast points. Forecasts exist only for some gauges. [20]
- **Not used:** Weather Underground, which some clubs point members to. The National Weather Service API covers the same forecast data for free.
- **UK:** Environment Agency flood monitoring API (flow, river status), referenced by Thames clubs. [13]
- **Global fallback:** Open-Meteo for weather, and its Global Flood API for modeled river discharge from GloFAS. That data is daily, modeled, and at about 5 km resolution, so it can pick the wrong river. Useful for trends, not a substitute for a gauge. [16]

## Known gaps

- The full USRowing Safety Guidelines PDF [17] and the full RowSafe document [4] have not yet been reviewed in detail. Review both before finalizing threshold types.
- Club policies above are a small sample, mostly US. Expand with tester clubs.

## Sources

1. USRowing, Safety and Safeguarding: https://usrowing.org/about-safety/safeguarding
2. USRowing, 9 Things to Know About Safety (May 2025): https://usrowing.org/news/9-things-to-know-about-safety
3. Rowing News, Cold Water Safety (Tom Rooks, USRowing Director of Safeguarding): https://www.rowingnews.com/?p=24628
4. British Rowing, RowSafe: https://www.britishrowing.org/about-us/policies-guidance/rowsafe/
5. Albany Rowing Center, Cold Weather Policy 2024: https://www.albanyrowingcenter.org/assets/docs/cold-weather-policy2024.pdf
6. Utah Crew, Safety Plan 2023: https://utahcrew.org/wp-content/uploads/sites/77/2023/09/UC_Safety_Plan_2023-FINAL.pdf
7. Indianapolis Rowing Center, Safety Policy: https://docs.google.com/document/d/1MayGWN3KqQq3GY6lF0Kp3DtsdXeU3odC/export?format=pdf
8. Des Moines Rowing Club, Safety Guidelines: https://desmoinesrowing.org/?p=116
9. Albany Rowing Center, Cold Weather Policy (2021): https://albanyrowingcenter.org/docs/01.2_ColdWeatherPolicy_ver2_Rev23June2021.pdf
10. Pittsburgh Rowing Club, Weather Safety: https://www.pittsburghrowingclub.com/weather-safety
11. British Rowing, Rowing in Strong Stream Conditions (2024): https://plus.britishrowing.org/2024/01/09/rowing-in-strong-stream-conditions/
12. British Rowing, Safety Alert: Don't Be Swept Into Danger: https://www.britishrowing.org/wp-content/uploads/2018/04/Safety-Alert-dont-be-swept-into-danger.pdf
13. Henley Rowing Club, Safety documents: https://henleyrowingclub.co.uk/safety
14. Cantabs Rowing Club, Safety: https://cantabsrowing.org.uk/?p=807
15. Twickenham Rowing Club, Rowing Safety Briefing: https://twickenhamrc.co.uk/_files/ugd/601a24_b691bf9107ec4518b1d80455a5001de6.pdf
16. Open-Meteo, Global Flood API docs: https://open-meteo.com/en/docs/flood-api
17. USRowing, Safety Guidelines (PDF, Dec 2022): https://usrowing-craft-storage-production.nyc3.digitaloceanspaces.com/staging/USRowing_SafetyGuidelines_20221201-1.pdf
18. USGS, WaterServices degradation notice (Sept 2026): https://waterdata.usgs.gov/blog/wdfn-waterservices-degradation/ and V1 release (Sept 2026): https://waterdata.usgs.gov/blog/api-v1-release/
19. Conditions guidance from a Connecticut River rowing club in Massachusetts, shared by a member (October 2026). Not a public document.
20. NOAA National Water Prediction Service, API docs: https://api.water.noaa.gov/nwps/v1/docs/ and data services overview: https://water.noaa.gov/about/api
