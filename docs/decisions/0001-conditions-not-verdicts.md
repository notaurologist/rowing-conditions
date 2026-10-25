# 0001: Conditions, not verdicts

Status: Accepted (October 2026)

## Context
Official rowing bodies publish qualitative guidance, not universal numeric limits. Clubs set their own rules, which vary widely. Safety depends on factors the app cannot see (crew experience, launch coverage, local hazards). Declaring conditions safe carries liability.

## Decision
The app reports conditions and compares them against user-entered thresholds. It never labels conditions safe or unsafe, never recommends rowing, and ships no default thresholds.

## Consequences
- Copy uses "within your limits" / "outside your limits" / "unknown."
- Missing data is a distinct state, never treated as passing.
- Users must enter limits before seeing highlighted windows.
