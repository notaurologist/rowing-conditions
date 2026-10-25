# 0009: Biome for linting and formatting

Status: Accepted (October 2026)

## Context
ESLint plus Prettier is the long-standing standard. Biome is newer, faster, and one tool with less configuration.

## Decision
Use Biome.

## Consequences
- Less config for agents to manage.
- Smaller rule ecosystem than ESLint; switch if a needed rule is missing.
