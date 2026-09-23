# Changelog

All notable changes are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-09-22

Renamed from BookKit to **OpenCalendar**; the embed API, events, webhook header and env var
names are unchanged, so existing embeds keep working.

- Schedules with date overrides, business-day windows, per-type limits, buffers and increments.
- Invitee reschedule and cancel with an enforced cutoff and automatic refunds by policy.
- Durable outbox with retries and alerts (email, webhook push), cron tick, canary and reconcile.
- Inline Stripe payments with pull-based confirmation; safe on a shared Stripe account.
- Brands, single-use links, embed.js popup preloading, REST API v1, MCP server, `import:calendly`.
- Admin: bookings, event types, availability troubleshooter, analytics, webhooks, API keys, data export/delete.

## [0.1.0] — first public release

The first release anyone else can run. Everything below the "Fixed" heading was
found by writing the test suite for behaviour the README already claimed.

### Added

- Booking pages with Google Calendar availability, Google Meet links, and free
  or Stripe-paid meeting types.
- `widget.js` embeds: popup, inline with auto-height, and plain iframes, with
  `bookkit.*` events re-emitted to the host page.
- Admin dashboard: meeting types, bookings, settings, and a retry for bookings
  that failed to reach the calendar.
- Outbound `booking.created` webhook, signed with `X-BookKit-Secret`.
- Cancellation links, per-IP rate limiting, and a honeypot on public forms.
- A `CalendarPort` seam (`lib/calendar.ts`) with Google and in-memory backends,
  so a fork can add CalDAV or Outlook without touching the rest of the app.
- Demo mode (`BOOKKIT_DEMO_MODE=1`): in-memory calendar, paid bookings refused,
  banner on every page, and a secret-guarded daily reset endpoint.
- Test suite: 130 unit and integration tests plus 32 Playwright end-to-end
  specs, covering every row of the README's correctness table. No test needs a
  Google account, a Stripe account, or a network connection.
- CI on every push: types, lint, unit, integration, end-to-end, and build.
- `docker compose up -d` for local Postgres.

### Fixed

- **A stale hold could permanently kill a slot.** The partial unique index
  counts every `PENDING_PAYMENT` row as live, but availability treats a hold
  past `expiresAt` as free. When `checkout.session.expired` never arrived —
  endpoint down, secret rotated, Stripe not configured — the slot stayed
  advertised while every attempt to book it failed with "That time was just
  taken", forever. The booking transaction now retires stale unpaid holds inside
  the lock it already holds. Paid-but-unsettled holds are exempt and are now
  recognised by the read paths too.
- **Mobile embeds rendered the desktop layout.** A phone gives an iframe a 980px
  layout viewport, so the container query matched, picked the side-by-side
  layout, and put 860px of slots inside a 330px scrollbox — a scroll trap on
  touch. The inner scrollbox is now standalone-only; embeds grow to fit.
- **The light theme was unreadable.** `<html>` is `data-theme="dark"`, so a
  light subtree redefined the tokens but kept inheriting body's near-white text
  colour. Headings and slot buttons rendered white-on-white.
- **Admin form labels were not associated with their inputs** — inert for screen
  readers and unclickable.

[0.1.0]: https://github.com/nchemb/opencalendar/releases/tag/v0.1.0
