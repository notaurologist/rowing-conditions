# 0018: Record API errors in Postgres

Status: Proposed (October 2026)

## Context
M8 needs basic error logging with no secrets in logs (#34). Vercel's Hobby plan keeps runtime logs for one hour, and log drains are paid only (0017), so `console` output alone is gone before anyone looks. Issue #99.

What the API reports today:

- About a dozen `logger.warn` calls through `consoleLogger`, each with a fixed message and small structured details: an adapter dropping a reading with an unknown unit, a response that didn't match its schema, a cache read or write that failed, the Nominatim gate being unavailable.
- Config errors at startup, through `console.error`.
- Nothing for unhandled exceptions. The Hono app has no `onError`, so Hono answers 500 and the error goes to the console.

The web app has an `ErrorBoundary` but reports nothing to the server.

Constraints: free tiers only, and state how the project stays within them (0015). Ask before adding a dependency. No secrets or personal data in logs.

Free-tier terms as of October 26, 2026, from each provider's own pages:

| Option | Free terms | Fit |
|---|---|---|
| Postgres table in Neon | No new service. Neon's free plan: 1 GB storage, 100 compute hours a month (0017). Writes happen only on errors, while the database is already awake for the request. | Chosen. No dependency, no new account or secret, and retention is ours to set. No alerts. |
| Sentry Developer | Free, 1 user, 5,000 errors and 5 GB of logs, 30-day lookback. The page doesn't say what happens over quota. | Runner-up. Stack traces, grouping, email alerts, and a browser SDK for web errors. Adds `@sentry/node` (and later a browser SDK), an account, and a DSN; request data leaves the app. |
| Axiom Personal | Free, no card: 500 GB ingest, 25 GB storage, 30-day retention. | Workable through its HTTP ingest API without a library. Another account and an API token secret, and no error grouping. |
| Better Stack | 3 GB of logs with 3-day retention; 100,000 exceptions a month. Card required, overage billed. | Rejected: needs a card and bills overage. |
| Vercel Observability (Hobby) | Included. Function error rates by route; runtime logs kept one hour. | Used alongside, not instead: shows that errors happen, not what they were. |

## Decision
- **Table `error_events`** in the existing database: `id`, `occurred_at`, `level` (`warn` or `error`), `message` (the fixed log message), `details` (jsonb, the structured details already passed to the logger), and `route` when known.
- **One logger for the app.** The logger the app builds writes each event to the console, as now, and inserts it into `error_events`. A failed insert is written to the console only and never fails the request.
- **Unhandled exceptions** go through a Hono `onError` handler that records the error's name, message, and stack, then answers 500 with a generic message.
- **No secrets or personal data.** Details stay the small structured fields the code chooses. Request bodies, headers, query strings, and IP addresses are never recorded. Place search queries are not recorded.
- **Retention: 30 days.** Older rows are deleted as part of an insert, at most once an hour per instance, so no scheduled job is needed (0006).
- **Reading them:** SQL against Neon, from its console or `psql`. A page in the app is out of scope.
- **Web errors** stay out of scope for M8. If needed, a small `POST /api/errors` endpoint can add them to the same table later.

## Consequences
- No new dependency, account, or secret. The work is one table, one logger, and an `onError` handler (#34).
- **Gaps.** Errors while the database is down reach only the console, kept one hour; Vercel Observability still shows the error rate. Nobody is notified. Someone has to look.
- **Staying free.** Rows are small and kept 30 days, far below Neon's 1 GB. If errors ever arrive at a rate that matters for storage, that's a problem to fix in itself.
- **Revisit** for Sentry if testers report problems this can't explain, or once there are enough users that alerts matter. That would add a dependency and needs the owner's call.
