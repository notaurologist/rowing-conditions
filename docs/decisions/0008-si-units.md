# 0008: SI units internally

Status: Accepted (October 2026)

## Context
US sources and users use cfs, ft, °F, mph. UK and most other countries use m³/s, m, °C. International expansion is a goal.

## Decision
Store and transmit SI (m³/s, m, °C, m/s). Adapters convert on ingest; clients convert for display. Exception: combined air plus water temperature is computed in °F because the rule is defined in Fahrenheit and a Celsius sum is not equivalent.

## Consequences
- One canonical unit per metric everywhere in the codebase.
- Conversions must be exhaustively tested.
