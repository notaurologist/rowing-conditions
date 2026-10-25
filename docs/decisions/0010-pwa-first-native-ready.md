# 0010: Web PWA first, architected for a native app

Status: Accepted (October 2026)

## Context
A web app is fastest to build and test. PWA notifications are unreliable, especially on iOS, and notifications are a likely post-MVP feature.

## Decision
Ship an installable PWA first. Keep business logic in `packages/core` and the API so a React Native (Expo) app can be added. Defer notifications to the native app.

## Consequences
- No notifications in the MVP.
- Path to notifications: accounts, server-stored thresholds, scheduled jobs, push.
