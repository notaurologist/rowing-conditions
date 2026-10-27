# Milestones

Status: Draft v0.2

Target: usable by testers in February, launched as the spring season opens (March to April). Roughly 10 to 20 hours per week.

Each milestone is small enough to break into agent tasks. A milestone is done when every acceptance criterion passes, tests are green, and any docs it affects are updated.

---

## M0: Repository setup (early November)

- pnpm workspace with `apps/api`, `apps/web`, `packages/core`.
- TypeScript strict, Biome, Vitest configured at the root; `pnpm lint`, `pnpm test`, `pnpm typecheck`, `pnpm dev` work across all packages.
- Exact versions pinned. Versions recorded in a decision record.
- A local pre-push hook and free-tier CI run lint, typecheck, and tests (decision 0015).
- `AGENTS.md` commands section matches reality.

**Accept when:** a fresh clone runs `pnpm install && pnpm test && pnpm dev` with no errors.

## M1: Core package (November)

- Domain types and Zod schemas per `ARCHITECTURE.md`.
- Unit conversions for all metrics, both display systems.
- Combined temperature computed in °F.
- Rule set model with user-defined boat classes.
- `findLimitingFactor` for choosing the default chart metric.
- Evaluation (`evaluateHour`, `evaluateTimeline`, `findWindows`) per rule set and boat class, with daylight window, forecast vs observed flow, and `unknown` handling.
- Daylight calculations via `suncalc`, including civil dawn and dusk and per-hour light level.

**Accept when:** unit tests cover every conversion, every evaluation rule, boundaries (value exactly at threshold), missing values, multiple rule sets, light levels, and darkness with and without a daylight window. Coverage of `evaluation/` is near complete.

## M2: USGS adapter and gauge search (November)

- Adapter implementing `FlowSource` against Water Data APIs v1.
- Nearby gauge search, gauge metadata including which parameters each reports.
- Latest readings with qualifiers; recent history for trend.
- Recorded fixtures, including a gauge with no water temperature and an ice-affected or missing reading.
- `/gauges/nearby` and `/gauges/:id` endpoints.

**Accept when:** adapter tests pass against fixtures; manual call against a real gauge returns correctly converted SI values.

## M2b: NWPS flow forecast adapter (November)

- Adapter implementing `FlowForecastSource`.
- Find forecast points near a location; link NWPS gauges to their USGS counterparts.
- Observed and forecast flow, unit conversion, interpolation to hourly, forecast issue time.
- Fixtures including a gauge with no forecast (for example `MNTM3` with forecast, plus one without).

**Accept when:** adapter tests pass; a real forecast point returns forecast flow in m³/s with issue time.

## M3: NWS adapter (late November to early December)

- Adapter implementing `WeatherSource`.
- Points lookup, grid data expanded to hourly points, alerts.
- Unit conversion based on WMO unit codes.
- Retry once on 5xx.
- Fixtures including missing gusts and a multi-hour `validTime` interval.

**Accept when:** adapter tests pass; 48 hourly points produced for a real location with correct units.

## M4: Conditions endpoint and caching (December)

- Postgres plus Drizzle schema and migrations (`source_cache`, `gauges`).
- `/conditions` endpoint merging sources (including forecast flow and rule-set flow gauges), per-source status, partial failure handling.
- TTL caching, stale fallback, in-process request deduplication.
- Env config validated at startup.

**Accept when:** route tests cover all-ok, one source failing, all failing with stale cache, and all failing with no cache.

## M5: Web app, location setup and current conditions (December)

- Map and search to pick a location; nearby gauges listed with what they report; gauge override.
- Weather-only mode when no gauge.
- Current conditions panel with freshness and source on every value, qualifiers shown, unit toggle.
- Saved locations in versioned local storage.

**Accept when:** a user can add a location, see current conditions, switch units, reload, and still see their saved location.

## M6: Timeline chart (January)

- Answer-first layout: next window for the selected rule set, then the chart, then periods from civil dawn to dusk with reasons.
- 48-hour visx chart showing the limiting-factor metric by default, with chips to switch (flow, wind and gusts, water temp, air temp, rain chance), the limit line, status strip, and light-level shading with text labels.
- Chart label explains which metric is shown and why; pinned metric preference stored locally.
- Works at phone widths.
- Chart components tested with fixture data.

**Accept when:** chart renders correctly from fixtures, including gaps for missing data, on both desktop and phone widths.

## M7: Rule sets (January)

- Rule set editor: name, boat classes, limits per class, daylight window, optional flow gauge.
- Attach several rule sets to a location; show each one's status for the selected hours.
- No default values; empty state prompts users to enter their own or their club's limits.
- Timeline highlights within, outside, and unknown hours, never by color alone.
- Neutral copy throughout (no "safe," "unsafe," "good to go").

**Accept when:** a user can enter two real club rule sets for the same water (different fleets and limits), attach both to one location, and see correct per-club highlighting; a copy review finds no verdict language.

## M8: PWA and deploy (late January)

- Installable PWA; offline shows last loaded data with its age.
- Deployed API, database, and web app. Hosting decision recorded.
- Basic error logging.

**Accept when:** installed on a phone, loads conditions for a real location from the deployed backend.

## M9: Backtesting (late January to February)

- Script to record historical fixtures for specific past dates and gauges.
- A set of notable days picked from last season's data (high water, cold mornings, windy days, gaps in gauge or station data). Each is replayed to show what the app would have shown that morning, then compared with what was measured that day.
- Review where the app's view and the measurements differ; fix gaps, and tune maximum ages and headroom scales.

No one's memory of a day is needed. Whether the app matches a crew's judgment on the water is left to tester feedback in M10.

**Accept when:** at least five notable days recorded, replayed, and compared with measurements, with findings captured in `docs/backtesting.md`.

## M10: Tester readiness (February)

- Short onboarding: what the app does and does not do (conditions, not verdicts).
- Recruit testers from own club and a few nearby clubs.

**Accept when:** at least five testers have it installed with their own locations and thresholds.

---

## After launch

See "After the MVP" in `PRODUCT.md`. Likely order: notifications groundwork (accounts, server thresholds, scheduled jobs), native app, club pages.
