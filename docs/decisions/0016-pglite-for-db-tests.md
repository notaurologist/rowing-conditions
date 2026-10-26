# 0016: PGlite for automated database tests

Status: Accepted (October 2026). Supersedes the test-database parts of 0013 and 0015.

## Context
From M4 on, the caching service and `/conditions` route tests need a database. 0013 planned route tests against Docker Compose Postgres and a CI service container (0015). The pre-push hook runs every test, so Docker tests would make every push depend on Docker running. That leaves two bad options: skipping database tests quietly, or failing for a reason unrelated to the change.

## Decision
- Automated tests use **PGlite** (`@electric-sql/pglite`, Postgres compiled to WebAssembly, run in process), with the committed Drizzle migrations applied to a fresh in-memory database.
- Docker Compose Postgres 18 stays for local development and manual checks.
- CI needs no database service.

## Consequences
- `pnpm check` and the pre-push hook run anywhere, with no Docker.
- Tests run real Postgres SQL and the real migrations and constraints. PGlite differs from the production server in some ways: one connection, and limited extension support. Anything that depends on those differences gets a manual check against Docker Postgres.
- Adds one dev dependency.
