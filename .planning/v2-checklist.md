# BookKit v2 build checklist
Spec: docs/REQUIREMENTS.md. Tick as done. Branch: v2 (bookkit repo).

## Core (reliability)
- [x] Schema v2 migration: Brand, Schedule(+overrides), MeetingType v2 fields, Booking v2 fields, Job outbox, BookingEvent audit, Alert, WebhookEndpoint, ApiKey, SingleUseLink, AnalyticsDaily
- [x] Slot engine v2: schedules + date overrides, start increments, buffers before/after, window modes (calendar/business/range/indefinite), min notice minutes, daily+weekly limits, multiple durations, pause mode, explain() troubleshooter
- [x] Multi-calendar freebusy (C2) + destination calendar (C3) + calendar list API
- [x] Booking: reserve w/ new rules, guests, location, UTM, single-use links; reschedule (G4) under lock; cancel w/ reason + cutoff (G3) + refund policy (E4)
- [x] Outbox jobs + /api/cron/tick + opportunistic drain; Google create retry job; emails/webhooks via outbox
- [x] Alerts: DB Alert rows + admin banner + email + optional push webhook (ntfy/Slack/Discord); /api/health; canary + reconcile jobs
- [x] Emails: confirmation w/ ICS, host notify, cancel/reschedule, reminders, follow-up, templates
- [x] Rate limit IP fix (trusted proxy), admin session revocation (session version)
- [x] Tests: unit + integration for all of the above; v1 tests still green

## Surfaces
- [x] Public booking page redesign (month grid, tz picker, 12/24h, a11y, prefill, UTM, dark/light, brand)
- [x] Brand profile pages + OG images
- [x] Success page w/ add-to-calendar; cancel + reschedule pages
- [x] embed.js v2 (popup/inline/badge/API/events/UTM passthrough/Calendly drop-in) + React file
- [x] Admin: bookings (tabs, detail, audit, no-show, cancel/reschedule, retry), event type editor, schedules editor, brands, settings (calendars, email, webhooks, API keys, alerts), share panel (snippets, QR), analytics, CSV, needs-attention
- [x] REST API v1 + OpenAPI + MCP endpoint
- [x] Webhook endpoints (HMAC signed, retries, log)

## OSS / rollout
- [x] npm run setup, env validation, Docker, README + docs (embed, migrate from Calendly), import:calendly
- [x] E2E Playwright green; CI green
- [x] Seed owner config (M1) locally via import:calendly; buildwithneej + alphaflow branches swapped; previews served (prod load = owner step, LAUNCH.md)

## Notes
- 184 tests green (unit + integration on real Postgres) as of commit 81224f9.
- Found + fixed a v1 bug: unpaid-hold sweeps used `{ not: "paid" }`, which excludes NULL → a hold that died before payment started burned its slot forever.
- Site swaps committed (not pushed): buildwithneej `bookkit-v2-swap` (.claude/worktrees/bookkit-v2), alphaflow `bookkit-v2-swap` (../alphaflow-bookkit-v2).
- Public UI, admin UI, integrations being built in worktrees ../bookkit-{public-ui,admin-ui,integrations}.
- Known flake (seen once, 2026-09-22, under heavy local load): 4 outbox/email tests in v2-booking.test.ts failed together; passed on 3 reruns. If it recurs, suspect INLINE_DRAIN_MS budget vs slow DB.
