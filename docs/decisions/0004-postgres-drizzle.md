# 0004: Postgres with Drizzle

Status: Accepted (October 2026)

## Context
Need storage for a cache and gauge catalog now, and accounts and thresholds later. Prisma is the more established TypeScript ORM; Drizzle is younger, popular, lightweight, and close to SQL.

## Decision
Postgres with Drizzle ORM and drizzle-kit migrations.

## Consequences
- Queries stay close to SQL, useful for learning and readability.
- Drizzle has had more API churn than Prisma; pin versions and check installed docs.
