# 0015: Free-tier CI plus local pre-push checks

Status: Accepted (October 2026)

## Context
The owner will not pay for hosted services, and has hit GitHub Actions free-tier limits on past projects. GitHub Actions on standard runners is free and unlimited for public repositories, and this repository is public. The owner also prefers running things locally where practical, even when it is slower.

## Decision
- **Local check.** A git pre-push hook (`.githooks/pre-push`) runs `pnpm check` (lint, typecheck, test) before every push. `pnpm install` turns it on through the root `prepare` script (`git config core.hooksPath .githooks`). `git push --no-verify` skips it once.
- **CI.** GitHub Actions runs the same checks on pull requests and pushes to `main`, as long as it stays free. CI covers pushes made with `--no-verify` or from a machine without the hook.
- **Hosted services in general.** Use free tiers only. Before adopting one, state its free-tier limits and how the project stays within them.

## Consequences
- Pushing requires pnpm on the PATH. The hook fails with an install hint if pnpm is missing.
- Changes that can end free-tier status must be raised with the owner before they happen. Examples: making the repository private (Actions minutes become metered), commercial use (for example Open-Meteo's non-commercial terms), or usage growth. If Actions stops being free, remove the workflow and rely on the hook.
- M4's Postgres-backed route tests may use a service container in Actions (0013) only while Actions is free. They must also run locally against Docker Compose.
