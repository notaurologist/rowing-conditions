# 0017: Vercel for the web app and API, Neon for Postgres

Status: Accepted (October 2026). Supersedes the Node 26 part of 0013.

## Context
M8 needs the API, the database, and the web app deployed (issue #32). The constraints:

- **Free tiers only** (0015). Before adopting a service, state its limits and how the project stays within them.
- **Short waits on first load.** People check conditions just before rowing, often early in the morning after hours without traffic. A host that sleeps and takes a minute to wake makes the first look of the day slow nearly every time.
- **Postgres 18** (0013), used for the source cache and the gauge table. The cache is an optimization: if the database fails, requests go to the sources directly.
- **The web app calls the API at `/api` on its own origin.** The API has no CORS. In development the Vite proxy handles this, so production needs the same.
- **The API was built as one long-running process.** The Nominatim gate (one request per second for the whole app, per OpenStreetMap's usage policy) and the cache's fetch deduplication live in memory.
- **The app is free and non-commercial.** The owner has no plans to charge for it.

Free-tier terms as of October 26, 2026, from each provider's own docs:

| Option | Free terms | Fit |
|---|---|---|
| Vercel Hobby | Free, for non-commercial personal use only. 4 active CPU hours (time waiting on the network doesn't count), 1 million function invocations, 100 GB transfer a month; over a limit, that feature stops for 30 days. Node 22 or 24. One hour of runtime logs; log drains are paid only. Services (web and API in one project) are in beta on all plans. | Chosen. Short cold starts. Needs Node 24 and a shared Nominatim gate. |
| Neon | Permanent, no card. 1 GB storage and 100 compute hours a month per project. Compute suspends after 5 minutes idle and wakes on connect. Postgres 14 to 18. | Chosen. |
| Render | Web service: 750 hours a month, spins down after 15 minutes idle, the next request waits about a minute. Static sites free. Postgres expires after 30 days. | Runner-up with Neon. Keeps Node 26 and one process, but the minute-long wake fails the first constraint unless a keep-alive ping uses about 744 of the 750 hours. |
| Koyeb | One free web instance per organization: 512 MB, 0.1 vCPU, scales to zero after 1 hour idle. No static hosting. | Rejected: still sleeps, and the web app would need another host and CORS. |
| Netlify Free | 300 credits a month, hard limit. A production deploy costs 15 credits, bandwidth 20 per GB. | Rejected: 20 production deploys a month uses every credit. |
| Railway | $1 of credit a month after a 30-day trial. | Rejected: not enough to run an API and database. |
| Fly.io | No free allowance for organizations created after October 2024. | Rejected: not free. |
| Owner's machine plus a tunnel | Free to run. | Rejected: down whenever the machine sleeps, and a stable URL needs a paid domain. |

## Decision
- **One Vercel project on the Hobby plan.** It holds two services: the `apps/web` build at `/`, and the Hono API at `/api/*`. The browser sees one origin, so the API needs no CORS and the web code keeps calling `/api`.
- **The API runs as Vercel Functions** with Fluid compute (the default), exported from an entry file Vercel detects. Local development keeps `@hono/node-server`.
- **Node 24 for the whole workspace**, replacing Node 26 from 0013. Vercel Functions offer only 22 and 24, and local development and CI should match production. Node 24 is in maintenance until April 2028. Move back to 26 once Vercel offers it.
- **The Nominatim gate moves into Postgres**, so it holds across function instances. Fetch deduplication stays per instance: a duplicate across instances costs one extra upstream call and nothing else.
- **Database:** a Neon free project on Postgres 18, reached through Neon's pooled connection string. Migrations run with `pnpm db:migrate` against Neon before a deploy that needs them.
- **Secrets** (`DATABASE_URL`, `NWS_USER_AGENT`, any `USGS_API_KEY`) live only in Vercel's environment settings, never in the repository.

## Consequences
- **Commercial use ends the free tier.** Vercel Hobby is for non-commercial personal use. Charging for the app, taking sponsorship, or running it for a business would mean a paid plan or a move; raise it with the owner first (0015).
- **Staying free.** Most of a request's time is spent waiting on USGS, NWPS, and NWS, which doesn't count as active CPU. In the first deploy (#34), about a dozen API requests used about 1 second of active CPU in total, so a request uses roughly 0.1 seconds or less and 4 hours covers well over 100,000 requests a month. The Usage page rounds to whole seconds, so this is an upper bound; re-check it after a week of real use. Going over stops functions for 30 days, so usage needs watching once testers start. Neon's 1 GB is far more than the cache and gauge tables need.
- **Logs.** One hour of runtime logs is too short for error logging (#34). Errors need a separate free service, which is a new dependency and the owner's call.
- **Work before the first deploy** (each its own issue): move the workspace to Node 24; move the Nominatim gate into Postgres; add the Vercel entry point, project config, and pooled connection settings.
- **Checked in the first deploy** (#34, October 27, 2026):
  - Cold start: after 17 minutes without traffic, `/api/health` took 0.32 s and the first conditions request 1.82 s, including Neon waking and refetching expired sources. Warm, they took 0.15 s and 0.28 s.
  - Services routing passes the `/api` prefix through to the API, which is why `vercel.ts` mounts the app under `/api`.
  - Services builds the pnpm workspace, including `apps/api`'s dependency on `packages/core`.
- **Reversible.** Only the entry file and project config are Vercel-specific. Render with Neon remains a fallback that needs no other code changes.
