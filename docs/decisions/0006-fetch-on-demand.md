# 0006: Fetch on demand with caching, no scheduled jobs in MVP

Status: Accepted (October 2026)

## Context
Only locations someone views need data. Scheduled fetching adds infrastructure that only notifications require.

## Decision
Fetch from sources when requested, cache normalized results in Postgres with per-source TTLs, serve stale data with a flag on upstream failure.

## Consequences
- Simple infrastructure; no workers.
- First request for a location is slower.
- Notifications will require scheduled jobs; revisit then.
