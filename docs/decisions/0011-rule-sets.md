# 0011: Limits organized as per-club rule sets

Status: Accepted (October 2026)

## Context
Rowers may row with more than one club on the same water. Each club sets its own limits and has its own fleet: one may have nothing larger than a double, another may run eights. A single global list of thresholds with a fixed small/large boat split cannot represent this.

## Decision
Limits live in named rule sets, usually one per club. Each rule set defines its own boat classes, limits (optionally scoped to classes), daylight window, and optional flow gauge. Several rule sets can be attached to one location and evaluated side by side.

## Consequences
- Supersedes the fixed `small | large` boat class in early drafts.
- UI copy names the rule set ("within Club A's limits"), never "go / no go."
- Natural path to club-published rule sets once accounts exist.
