# Product Spec

Status: Draft v0.2
Name: Launch Window (decided in #43, October 2026). Internal names (repository, packages, storage keys) stay `rowing-conditions`.

## Overview

A web app (native app later) that helps rowers decide whether and when to row on a specific body of water in the next 48 hours. It combines river flow, water temperature, wind, weather, and daylight into a single view, and highlights time windows that fall within limits the user or their club defines.

## Problem

Before an outing, rowers check several separate sources: a USGS gauge page for flow and water temperature, a weather app for wind and gusts, and something else for sunrise and sunset. Club safety rules then have to be applied mentally against those numbers. This is tedious, easy to get wrong, and matters most early in the season, when water is high and cold.

## Target users

- **Primary:** individual rowers (scullers and sweep rowers) on rivers and lakes, checking conditions before an outing.
- **Secondary:** coaches and club safety officers who apply club rules to decide whether crews go out.

The MVP is built for the primary user. Club features come after the MVP and are the most likely paid tier.

## Core principle: conditions, not verdicts

The app reports conditions and compares them against thresholds the user enters. It never declares conditions "safe" or "unsafe," and never recommends whether to row.

Reasons:

1. Official rowing bodies do not publish universal numeric limits. Real rules are set locally by clubs and vary widely (see `DOMAIN.md`).
2. Safety judgments depend on factors the app cannot see: crew experience, boat type, launch coverage, local hazards.
3. It keeps liability low.

Implications for all features and copy:

- No default thresholds that imply safety. When a rule set is empty, prompt the user to enter their own or their club's limits.
- Use neutral language: "within your limits" / "outside your limits," never "safe" / "unsafe" / "good to go."
- Show data freshness and source on every reading. Stale or missing data must be obvious, never silently hidden.

## MVP scope

### 1. Location setup

- Search for or pick a location on a map.
- The app finds the nearest flow gauge and weather forecast point.
- The user can override the gauge, since the nearest gauge is not always the relevant one (dams and tributaries can change conditions).
- Locations without a gauge (most lakes and ponds) work in weather-only mode.

### 2. Current conditions

- Flow (discharge) and gauge height, with trend (rising, falling, stable) and rate of change, and forecast flow where available.
- Water temperature, where the gauge reports it. Listed first, since cold water is the most significant temperature risk, but styled like the other readings: emphasis read as a selection and as the app judging which reading matters (October 2026).
- Wind speed, gusts, and direction.
- Air temperature.
- Sunrise and sunset.
- Active weather alerts.
- Timestamp and source for each reading.

### 3. 48-hour timeline

The centerpiece of the product. The main screen leads with the answer (the next window within the selected rule set's limits, and what follows), then the chart, then a plain-language summary of each day from civil dawn to civil dusk with reasons.

The chart is a **rowing meteogram**: every element on one shared time axis, each in its customary form, so nothing has to be switched on to be seen (decided in #77, October 2026).

- **River flow** as a hydrograph, wind as a band from sustained speed to gusts with direction arrows, air and water temperature as lines, and rain chance as bars.
- **Limits:** each limit is a line on its row, and the space between the forecast and the limit is filled: a light tint for the room left, red where the forecast is past it.
- **Status:** a strip above the rows shows each span within, outside or unknown, in words, with ● within, ○ outside and ? unknown beside them where the words fit. Outside spans are striped and unknown spans dotted, so even a one-hour span is told apart without color, and the strip lines up with the hours below. The symbols only describe position against the limits; ✓ and ✕ were replaced because a check mark reads as approval (decided in #91, October 2026). With several rule sets attached, each gets its own strip, and the rows draw the selected one's limits.
- **Windows** within the rule set's limits are bracketed above the rows and carried down through them.
- **Latest measurements** are shown as dots against the forecast lines, so a forecast that has drifted from what's measured is visible. The lines start at the first forecast hour rather than joining the dot. A measurement far off the forecast's scale sits at the row's edge with an arrow.
- **Course wind:** with a course saved for the location (tap the start and the turn; it follows the river), each hour gives the share of headwind, crosswind and tailwind on the way out and the way back, with the course's notes. Context only (decided in #103).
- **Fog** is the NWS forecaster's call for each hour, in words ("Patchy fog (NWS)"), in the readout and the hourly table, with the air temperature's gap to the dew point. Context only, like light (decided in #42).
- **Light level** is shaded (twilight, night) from the exact civil dawn, sunrise, sunset and civil dusk. Light is context: crews often row before sunrise with lights, so it does not change whether an hour is within limits unless a rule set sets a hard daylight window.
- **Readout:** one readout line shows every row's value and its margin to the limit at any hour, by pointer or by slider. Every value is also in an hourly table.
- **Missing rows:** flow at a weather-only location gets a row that says so. Water temperature at a gauge without a sensor is left out, unless a limit needs it, when its row says it isn't measured.

### 4. Rule sets

Rowers often row with more than one club on the same water, and each club has its own rules and fleet. So limits are organized as **rule sets**, not one global list.

- A rule set is a named collection of limits, typically one per club (for example "Club A rules", "Club B rules") or a personal set.
- Each rule set defines its own boat classes, since fleets differ (one club may have nothing larger than a double, another may have eights). Boat classes are user-named, not a fixed list.
- Limits: max wind, max gusts, max flow, min water temperature, min air temperature, min combined air plus water temperature. Each limit applies to all boat classes in the set or to specific ones.
- A rule set can name the gauge its flow limit is measured at, since clubs tie flow limits to a specific gauge.
- Optional daylight window per rule set, only for clubs that forbid rowing outside set hours.
- Several rule sets can be attached to one location, and the main screen can show each one's status side by side (for example, within one club's limits but outside another's at the same hour).
- Copy refers to the rule set by name: "within Club A's limits," never "go" or "no go."

### 4a. Flow forecast

Where NOAA's National Water Prediction Service publishes a flow forecast for the gauge, the timeline uses forecast flow for each hour. Clubs already rely on these forecasts. Where no forecast exists, the latest observation applies to all hours, clearly labeled.

### 5. No accounts

Saved locations and thresholds are stored on the device. No authentication in the MVP.

### 6. Platform

Mobile-friendly web app, installable as a PWA. See "Platform strategy" below.

## Non-goals (MVP)

- Safe/unsafe verdicts or recommendations to row.
- Training logs or workout tracking.
- Social features.
- Native apps.
- Payments.
- Accounts and cross-device sync.
- Notifications (deferred to native; see below).

## Platform strategy

PWA notifications are unreliable, especially on iOS, and notifications are a likely key feature after the MVP. The architecture must make a native app (likely React Native via Expo) a straightforward addition:

- Business logic (data fetching, normalization, threshold evaluation) lives on the backend or in shared packages, never only in the web client.
- Clients are thin consumers of the backend API.
- Notifications, when added, are sent from the backend.

## International support

The MVP targets the US (USGS and NWS data). The design must not block other countries:

- Data sources are swappable adapters behind one internal format.
- Measurements are stored in SI units and converted for display based on user preference.
- Rule structures in `DOMAIN.md` were checked against both US and UK practice.

## Success criteria (end of spring season)

- Jason uses it before every outing instead of checking other sites.

There is no formal user testing. Jason shares it informally and doesn't plan to collect feedback.

## After the MVP (candidates)

- Notifications ("within your limits tomorrow 6 to 8 AM").
- Native mobile app.
- Shared club pages: a club publishes its rule set so members subscribe instead of entering limits by hand.
- Wind against the current (the course itself is done: #103).
- Lightning proximity.
- Banded or zone-based rules (see `DOMAIN.md`).
- Tide data for tidal rivers.
- Dam release and drawdown schedules, where operators publish them. Needs per-operator research first; no reliable common source is known.
- Suggest minimum flow or gauge height limits in the rule set editor, for low water.
- Additional countries (UK Environment Agency first).
- Accounts and sync.

## Open questions

- Data refresh frequency and caching strategy (sources update on different schedules).
- Handling gauges that go offline or report bad data in freezing conditions.
- Whether one location can use multiple gauges (for example, one for flow and another for water temperature). Partly answered: rule sets name their own flow gauge.
- Product name.
