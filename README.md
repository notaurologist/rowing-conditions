# Rowing Conditions

A web app that shows rowers river flow, water temperature, wind, weather, and daylight for a specific body of water over the next 48 hours, and compares them against limits the rower or their club sets. A native mobile app comes later. The product name is still to be decided.

The app reports conditions. It never says whether conditions are safe or whether to row. Hours are shown as within a rule set's limits, outside them, or unknown. See [`docs/PRODUCT.md`](docs/PRODUCT.md) for the reasons.

**Status:** early development. Milestone M0 (repository setup) is complete; M1 (core evaluation logic) is next. Progress is tracked in [GitHub milestones](https://github.com/notaurologist/rowing-conditions/milestones).

## Setup

Requires Node 26 and pnpm 12.15.0.

```bash
nvm install    # reads .nvmrc
npm install -g pnpm@12.15.0
pnpm install   # also turns on the pre-push hook
docker compose up -d   # local Postgres 18 (needs Docker)
pnpm db:migrate
pnpm dev       # api on http://localhost:3000, web on http://localhost:5173
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the API and web app with reload on change |
| `pnpm test` | Runs every package's tests with Vitest |
| `pnpm typecheck` | Runs `tsc` in every package |
| `pnpm lint` | Biome lint and format check (code and config, not Markdown) |
| `pnpm format` | Formats with Biome |
| `pnpm check` | Lint, typecheck, and test; runs before every push and in CI |
| `pnpm coverage` | Tests with coverage; text summary plus an HTML report in `coverage/` |
| `pnpm db:migrate` | Applies database migrations (local Docker Postgres unless `DATABASE_URL` is set) |

`git push --no-verify` skips the pre-push check once.

## Layout

```
apps/api       Hono API on Node (fetches and normalizes source data)
apps/web       React app built with Vite
packages/core  Shared types, unit conversions, and threshold evaluation
docs/          Product, domain, architecture, data sources, milestones, decisions
```

## Docs

- [`docs/PRODUCT.md`](docs/PRODUCT.md): scope, non-goals, and the core principle
- [`docs/DOMAIN.md`](docs/DOMAIN.md): rowing conditions and how clubs set limits
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): system design and evaluation rules
- [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md): USGS, NWPS, and NWS APIs
- [`docs/MILESTONES.md`](docs/MILESTONES.md): the plan to a spring launch
- [`docs/decisions/`](docs/decisions/): decision records
- [`AGENTS.md`](AGENTS.md): rules for coding agents working in this repo
