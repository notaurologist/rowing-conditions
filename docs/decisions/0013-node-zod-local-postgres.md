# 0013: Node 26, Zod 4, and local Postgres via Docker Compose from M4

Status: Accepted (October 2026). The test-database part is superseded by 0016: tests use PGlite, not Docker or a CI service container.

## Context
M0 needs three choices before scaffolding (issue #2). Facts as of October 25, 2026:

- **Node.** Node 24 moved from Active LTS to maintenance on October 20, 2026 (end of life April 2028). Node 26 becomes Active LTS on October 28, 2026 (end of life April 2029). The latest 26.x is 26.12.1. Source: the Node.js release schedule (github.com/nodejs/Release).
- **Zod.** The current version is 4.6.7. `@hono/zod-validator` 0.9.1 accepts `zod ^3.25.0 || ^4.0.0`. Drizzle does not depend on Zod. No part of the stack needs Zod 3.
- **Postgres.** The latest major is 18 (supported to November 2030). The database first appears in M4; M0 through M3 need none. Docker Desktop is installed on the owner's machine but was not running when checked. Drizzle supports `postgres`, `pg`, and PGlite (Postgres compiled to WebAssembly, run in process).

## Decision
1. **Node 26.** Pin the major in `.nvmrc` and `engines`, and use the same file in CI (`node-version-file`). It is LTS before M0's due date and supported through the whole project horizon.
2. **Zod 4.** Pinned exactly like every other dependency.
3. **No database in M0.** `pnpm dev` runs without Postgres until M4. At M4, add a `docker-compose.yml` with the official `postgres:18` image for local development, and a Postgres service container in GitHub Actions for route tests. The hosting choice in M8 must offer Postgres 18, or this pin moves to match it.

## Alternatives considered
- **Node 24.** Already in maintenance, ending 2028. No reason to start a new project on it.
- **Zod 3.** Only useful for compatibility with libraries that require it. None in the stack do.
- **PGlite for local development and tests.** No Docker needed, and it is fast for tests. It adds a dependency and is not the same server as production (single connection, differing extension support). Worth reconsidering at M4 for route tests only, if the service container is slow.
- **Homebrew or Postgres.app.** Works, but is per-machine setup that CI cannot share.

## Consequences
- Contributors need Node 26 and, from M4, Docker.
- M0's acceptance check (`pnpm install && pnpm test && pnpm dev` on a fresh clone) has no database step.
- Exact package versions are recorded separately when M0 scaffolds the workspace (issue #3).
