# 0017: Render for the API and web app, Neon for Postgres

Status: Proposed (October 2026)

## Context
M8 needs the API, the database, and the web app deployed (issue #32). The constraints:

- **Free tiers only** (0015). Before adopting a service, state its limits and how the project stays within them.
- **The API is one long-running Node 26 process.** The Nominatim gate and the cache's fetch deduplication are in-process, so the API must run as a single instance (`ARCHITECTURE.md`, Data fetching).
- **Postgres 18** (0013), used for the source cache and the gauge table. The cache is an optimization: if the database fails, requests go to the sources directly.
- **The web app calls the API at `/api` on its own origin.** The API has no CORS. In development the Vite proxy handles this, so production needs the same: a rewrite on the web host, or CORS plus `VITE_API_URL`.
- **The web app is a PWA.** Its shell is cached on the phone and it shows the last loaded conditions while it waits for the network (#94).

Free-tier terms as of October 26, 2026, from each provider's own docs:

| Option | Free terms | Fit |
|---|---|---|
| Render web service | 750 instance hours a month per workspace. Spins down after 15 minutes without traffic; the next request waits about a minute. Node version from `.nvmrc`. | Runs the API as one Node process. Cold starts are the cost. |
| Render static site | Free, served from a CDN, counts against the workspace's monthly bandwidth. Rewrites can point at a full URL. | Serves the web build; a rewrite sends `/api/*` to the API. |
| Render Postgres | 1 GB, expires 30 days after creation, deleted 14 days later. No backups. | Rejected: expires. |
| Neon | Permanent, no card. 1 GB storage and 100 compute hours a month per project. Compute suspends after 5 minutes idle and wakes on connect. Postgres 14 to 18. | Postgres 18 with room to spare. |
| Koyeb | One free web instance per organization: 512 MB, 0.1 vCPU, scales to zero after 1 hour without traffic, Washington or Frankfurt. No static hosting. | Fewer cold starts than Render, slower CPU. The web app would need another host and CORS. |
| Vercel Hobby | Free, for non-commercial personal use only. Functions, not a long-running server: 4 active CPU hours, 1 million invocations, 100 GB transfer a month; over a limit, the feature stops for 30 days. Node 22 or 24 only. One hour of runtime logs. | Rejected for the API: no Node 26, and concurrent function instances break the in-process Nominatim gate, which would have to move to the database. Cold starts would be far shorter than Render's. Fine for the static web app. |
| Netlify Free | 300 credits a month, hard limit. A production deploy costs 15 credits, bandwidth 20 per GB, compute 10 per GB-hour. | Rejected: 20 production deploys a month uses every credit, before any traffic. Its API would be functions, with the same problems as Vercel. |
| Railway | $1 of credit a month after a 30-day trial. Trial volumes are deleted 30 days after credits run out. | Rejected: $1 does not cover an always-available API and database. |
| Fly.io | No free allowance for organizations created after October 2024; a trial of 2 machine-hours or 7 days. | Rejected: not free. |
| Owner's machine plus a tunnel | Free to run; Docker Compose already runs Postgres 18. | Rejected: the app is down whenever the machine sleeps, and a stable tunnel URL needs a domain, which costs money. |

## Decision
- **API:** a Render free web service, built from this repository, started with `node`. One instance.
- **Web app:** a Render static site from the `apps/web` build, with a rewrite from `/api/*` to the API's Render URL. The browser sees one origin, so the API needs no CORS and the web code stays as it is.
- **Database:** a Neon free project on Postgres 18. `DATABASE_URL` is set on the Render service. Migrations run with `pnpm db:migrate` as part of the API's deploy.
- **Secrets** (`DATABASE_URL`, `NWS_USER_AGENT`, any `USGS_API_KEY`) live only in Render's environment settings, never in the repository.

## Consequences
- **Cold starts.** After 15 minutes without traffic, the first request waits about a minute while the API starts, plus a short wait while Neon wakes (not measured). The app shell opens at once from the phone's cache and shows the last loaded conditions with their age, then updates. No keep-alive ping is planned; one would use about 744 of the 750 monthly hours and should be the owner's call.
- **Staying free.** One web service running all month needs at most 744 hours, under the 750. A second free web service in the same workspace would share those hours. The cache and gauge tables are far below Neon's 1 GB. Usage growth, a second service, or either provider changing its free terms must be raised with the owner before it happens (0015).
- **Single instance.** Render's free tier runs one instance, which matches the in-process Nominatim gate and fetch deduplication. Scaling out would need those moved to the database first.
- **Not verified yet**, to confirm in the first deploy (#34):
  - Render builds with Node 26 from `.nvmrc`. Its docs accept exact versions and ranges, but its default is 24.22.1 and none of its examples use 26.
  - A static-site rewrite to another host proxies the request rather than redirecting it. The docs allow a full URL as the destination but do not describe this case.
  - Render's monthly included bandwidth for the free workspace. The docs say static sites count against it but do not give the number on the pages checked.
- **Logs.** Error logging, and how long Render keeps logs on the free tier, are part of #34.
- **Reversible.** Nothing here is Render- or Neon-specific in code. Moving means pointing `DATABASE_URL` elsewhere and redeploying the same build.
