# AGENTS.md

A web app that shows rowers river flow, water temperature, wind, weather, and daylight for a specific body of water over the next 48 hours, compared against limits the user sets. Native mobile app later.

## Read before working

| Doc | Read when |
|---|---|
| `docs/PRODUCT.md` | Always, once per session. Scope, non-goals, core principle. |
| `docs/DOMAIN.md` | Anything touching conditions, thresholds, units, or user-facing copy. |
| `docs/ARCHITECTURE.md` | Any code change. |
| `docs/DATA_SOURCES.md` | Any adapter work. Verify against official docs first. |
| `docs/MILESTONES.md` | Picking up or scoping work. |
| `docs/decisions/` | Before changing a technology or pattern. Do not relitigate recorded decisions without asking. |

## Hard rules

1. **Never present conditions as safe or unsafe.** No verdicts, no "go / no go," no recommendations to row, no default limits. Use "within [rule set]'s limits" / "outside" / "unknown."
2. **Missing data is never treated as acceptable.** Unknown is its own state, shown clearly.
3. **Store and transmit SI units.** Convert only for display. Exception: combined air plus water temperature is computed in °F.
4. **Business logic goes in `packages/core` or `apps/api`,** never only in `apps/web`.
5. **Parse every external response with Zod** inside the adapter. Convert units inside the adapter.
6. **Use USGS Water Data APIs v1** (`api.waterdata.usgs.gov/ogcapi/v1`) for observations and the **NWPS API** (`api.water.noaa.gov/nwps/v1`) for flow forecasts. Never the legacy `waterservices.usgs.gov`.
7. **No live network calls in tests.** Use recorded fixtures.
8. **No secrets** in code, fixtures, or logs.
9. **Never convey status by color alone.**
10. **Ask before** adding a dependency, changing a recorded decision, or expanding scope beyond the current milestone.

## Stack

pnpm workspaces · TypeScript (strict) · Hono on Node · Zod · Postgres with Drizzle · React with Vite · TanStack Query · visx · Leaflet · vite-plugin-pwa · suncalc · Vitest · Biome

Versions are pinned exactly. Libraries like Hono and Drizzle change quickly: check the installed version's docs rather than relying on memory.

## Commands

Keep this list to commands that work today. Requires Node 26 (`.nvmrc`) and pnpm 12.15.0.

```
pnpm install        # also turns on the pre-push hook
pnpm dev            # api on :3000, web on :5173
pnpm test           # Vitest, every package
pnpm typecheck      # tsc in every package
pnpm lint           # Biome check (code and config, not Markdown)
pnpm format         # Biome format, writes changes
pnpm check          # lint, typecheck, test; what the pre-push hook and CI run
pnpm coverage       # tests with v8 coverage; add --project @rowing/core for one package
```

Run one package's script with `pnpm --filter @rowing/api <script>` (or `@rowing/web`, `@rowing/core`).

Added later, with their milestones: `pnpm db:migrate` (M4) and `pnpm fixtures:record` (M2, manual only, never in the pre-push check or CI).

## Conventions

- Small, focused changes. One milestone task per branch or PR.
- Tests alongside every change; evaluation and unit logic need exhaustive tests.
- Name things by domain terms from `DOMAIN.md` (flow, gauge height, rule set, boat class, threshold).
- No `any` without a comment explaining why.
- Update the relevant doc in the same change when behavior or decisions change.
- Times are ISO 8601 UTC internally; convert to the location's timezone for display.

## Tracking work

Work is tracked in GitHub issues, grouped into milestones that match `docs/MILESTONES.md`.

- Pick up the lowest-numbered open issue in the earliest open milestone, skipping any that say "Blocked by #n" while #n is open. Issue bodies list docs to read and acceptance criteria.
- Issues labeled `decision` need the owner's call. Research and propose; do not decide.
- Reference the issue in the PR with `Closes #n`.
- If work turns up a new task or question, open an issue for it instead of expanding the current PR.
