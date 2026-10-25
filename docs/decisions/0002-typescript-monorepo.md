# 0002: TypeScript monorepo with pnpm workspaces

Status: Accepted (October 2026)

## Context
The project is built mostly by coding agents. A TypeScript-first default was chosen for agent-driven greenfield work. A native app is planned later and should share logic with the web app.

## Decision
Single repo with pnpm workspaces: `apps/api`, `apps/web`, `packages/core`, and later `apps/mobile`. TypeScript strict everywhere. Exact version pinning.

## Consequences
- Shared types and logic across server and clients.
- One toolchain for agents to learn.
