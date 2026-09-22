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
- [ ] Public booking page redesign (month grid, tz picker, 12/24h, a11y, prefill, UTM, dark/light, brand)
- [ ] Brand profile pages + OG images
- [ ] Success page w/ add-to-calendar; cancel + reschedule pages
- [ ] embed.js v2 (popup/inline/badge/API/events/UTM passthrough/Calendly drop-in) + React file
- [ ] Admin: bookings (tabs, detail, audit, no-show, cancel/reschedule, retry), event type editor, schedules editor, brands, settings (calendars, email, webhooks, API keys, alerts), share panel (snippets, QR), analytics, CSV, needs-attention
- [ ] REST API v1 + OpenAPI + MCP endpoint
- [ ] Webhook endpoints (HMAC signed, retries, log)

## OSS / rollout
- [x] npm run setup, env validation, Docker, README + docs (embed, migrate from Calendly), import:calendly
- [ ] E2E Playwright green; CI green
- [ ] Seed owner config (M1); buildwithneej + alphaflow local branches swapped to BookKit; previews served

## Notes
- 184 tests green (unit + integration on real Postgres) as of commit 81224f9.
- Found + fixed a v1 bug: unpaid-hold sweeps used `{ not: "paid" }`, which excludes NULL → a hold that died before payment started burned its slot forever.
- Site swaps committed (not pushed): buildwithneej `bookkit-v2-swap` (.claude/worktrees/bookkit-v2), alphaflow `bookkit-v2-swap` (../alphaflow-bookkit-v2).
- Public UI, admin UI, integrations being built in worktrees ../bookkit-{public-ui,admin-ui,integrations}.
