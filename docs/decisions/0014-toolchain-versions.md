# 0014: Toolchain versions at M0

Status: Accepted (October 2026)

## Context
M0 pins exact versions (decision 0002). Several tools have had major releases since the docs were written, so agents relying on memory will reach for the wrong APIs.

## Decision
Pin these as installed on October 25, 2026. `package.json` files hold the exact versions; this record lists the majors that change how code is written.

| Tool | Version | Notes |
|---|---|---|
| Node | 26 (`.nvmrc`, `engines`) | Runs the API's TypeScript directly via type stripping. No `tsx` or build step for the API. |
| pnpm | 12.15.0 (`packageManager`) | Enforces a minimum release age on new packages. Pin a release older than about a day rather than adding exclusions. |
| TypeScript | 7.0.2 | The native compiler. Used only for `tsc` typechecking; Vite and Node strip types themselves. |
| Vite | 8.3.5 | Rolldown-based. |
| `@vitejs/plugin-react` | 6.1.2 | |
| React | 19.3.1 | |
| Hono | 4.13.13 | 4.13.14 was under a day old at install. |
| `@hono/node-server` | 2.1.5 | |

Added later with their own tickets: Zod 4 (0013), Vitest and Biome (#4), Drizzle (M4).

## Consequences
- TypeScript settings that follow from Node type stripping: `erasableSyntaxOnly` (no enums or parameter properties), `allowImportingTsExtensions`, and relative imports written with `.ts`.
- Workspace packages export their `src/*.ts` directly. Node resolves the pnpm symlink to the real path, so type stripping works across packages (checked by importing `@rowing/core` from `apps/api`).
- Check each tool's docs for the installed major before relying on remembered APIs.
