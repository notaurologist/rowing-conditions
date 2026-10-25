# 0012: NWPS flow forecasts in the MVP

Status: Accepted (October 2026)

## Context
Flow forecasts were planned for after the MVP. Local clubs already rely on NOAA National Water Prediction Service hydrographs, which show observed flow and a multi-day forecast, and flow is often the deciding rule. NWPS offers a public API.

## Decision
Add an NWPS adapter in the MVP. Where a gauge has a forecast, the timeline evaluates flow per hour from it; otherwise the latest observation applies, labeled as such.

## Consequences
- One more adapter and milestone (M2b).
- Gauges must be linked across USGS and NWPS to avoid duplicates.
- NWPS has no historical observations, so backtesting stays on USGS data.
