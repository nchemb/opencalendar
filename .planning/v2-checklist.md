# BookKit v2 build checklist
Spec: docs/REQUIREMENTS.md. Tick as done. Branch: v2 (bookkit repo).

## Core (reliability)
- [ ] Schema v2 migration: Brand, Schedule(+overrides), MeetingType v2 fields, Booking v2 fields, Job outbox, BookingEvent audit, Alert, WebhookEndpoint, ApiKey, SingleUseLink, AnalyticsDaily
- [ ] Slot engine v2: schedules + date overrides, start increments, buffers before/after, window modes (calendar/business/range/indefinite), min notice minutes, daily+weekly limits, multiple durations, pause mode, explain() troubleshooter
- [ ] Multi-calendar freebusy (C2) + destination calendar (C3) + calendar list API
- [ ] Booking: reserve w/ new rules, guests, location, UTM, single-use links; reschedule (G4) under lock; cancel w/ reason + cutoff (G3) + refund policy (E4)
- [ ] Outbox jobs + /api/cron/tick + opportunistic drain; Google create retry job; emails/webhooks via outbox
- [ ] Alerts: DB Alert rows + admin banner + email + optional push webhook (ntfy/Slack/Discord); /api/health; canary + reconcile jobs
- [ ] Emails: confirmation w/ ICS, host notify, cancel/reschedule, reminders, follow-up, templates
- [ ] Rate limit IP fix (trusted proxy), admin session revocation (session version)
- [ ] Tests: unit + integration for all of the above; v1 tests still green

## Surfaces
- [ ] Public booking page redesign (month grid, tz picker, 12/24h, a11y, prefill, UTM, dark/light, brand)
- [ ] Brand profile pages + OG images
- [ ] Success page w/ add-to-calendar; cancel + reschedule pages
- [ ] embed.js v2 (popup/inline/badge/API/events/UTM passthrough/Calendly drop-in) + React file
- [ ] Admin: bookings (tabs, detail, audit, no-show, cancel/reschedule, retry), event type editor, schedules editor, brands, settings (calendars, email, webhooks, API keys, alerts), share panel (snippets, QR), analytics, CSV, needs-attention
- [ ] REST API v1 + OpenAPI + MCP endpoint
- [ ] Webhook endpoints (HMAC signed, retries, log)

## OSS / rollout
- [ ] npm run setup, env validation, Docker, README + docs (embed, migrate from Calendly), import:calendly
- [ ] E2E Playwright green; CI green
- [ ] Seed owner config (M1); buildwithneej + alphaflow local branches swapped to BookKit; previews served
