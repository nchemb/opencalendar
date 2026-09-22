# BookKit v2 — Requirements

Open-source, self-hosted Calendly replacement. One deploy = one host (you), any number of
booking links, any number of brands/sites. Drop a script tag on any site or put the link in
your bio and it books straight into your Google Calendar, optionally charging with Stripe.

Written 2026-09-22 from: Calendly's 2026 feature set (`.planning/research/calendly-features.md`),
the owner's live Calendly config (`.planning/research/current-calendly-config.md`), and the
v1 audit (`.planning/audit-v1.md`).

**Priority key.** **P0** = must work before the owner cancels Calendly (both sites run on it).
**P1** = ships in v2 for OSS adopters, makes it "relatively comprehensive". **P2** = explicitly
later / out of scope for v2 (listed so nobody mistakes a gap for an oversight).

**Reliability is requirement zero.** A missed, lost, or double booking is the one failure this
product cannot have. Every section below is subordinate to section R.

---

## R. Reliability & correctness (P0 unless marked)

- R1 **No double booking.** Slot claim runs in one DB transaction under a per-host lock that
  re-checks (a) overlapping live bookings incl. buffers and (b) live Google free/busy for the
  exact interval, immediately before commit. Concurrent requests for one slot: exactly one wins.
- R2 **No lost booking.** The booking row is committed before any side effect. Google event,
  emails, outbound webhooks run from a durable outbox (DB rows with attempts/next-run/last-error),
  retried with backoff by cron and on demand. A side-effect failure never rolls back or hides a
  booking.
- R3 **Paid bookings.** Slot is held (PENDING_PAYMENT, expiry) while the invitee pays. Hold
  outlives the Stripe payment window. Webhook handling is idempotent (event id dedupe) and only
  acts on objects this install created (metadata tag + id match) — a shared Stripe account's other
  sites' events are ignored. Payment that lands after the hold expired and the slot was taken →
  automatic full refund + both parties emailed. Payment success is also confirmed by a client-side
  return path (not webhook-only), so a delayed webhook never strands a paid invitee.
- R4 **Calendar failure is loud, not silent.** Google token refresh failure / revoked access →
  host alerted by email immediately (deduped), admin banner, `/api/health` reports degraded.
  Bookings still commit (Google write queued) unless the host sets "stop taking bookings when
  calendar is disconnected" (default ON: availability can't be trusted without free/busy).
- R5 **Heartbeat / canary.** Cron job checks every active public booking link returns ≥1 slot in
  its window and that Google + Stripe + email credentials work; alerts host on failure (deduped,
  once per incident). `/api/health` JSON for external uptime monitors.
- R6 **Reconcile.** Cron compares upcoming confirmed bookings with their Google events. Event
  deleted or moved in Google → host alerted with one-click "cancel booking & notify invitee" or
  "ignore". (Detect, never auto-cancel.)
- R7 **Time correctness.** All storage UTC. Slot math in host schedule timezone with Luxon,
  DST-safe (spring-forward gaps skipped, fall-back duplicates not doubled). Invitee timezone is
  display-only. Rolling window counts calendar days in host tz (Calendly semantics: "N days into
  the future").
- R8 **Audit trail.** Every booking state change and side effect is written to a BookingEvent log,
  visible on the booking detail page.
- R9 **Tests.** Unit (slot engine, DST, limits, windows), integration against real Postgres
  (concurrency, paid flow, webhook crosstalk, outbox retry, cancel/reschedule), e2e (Playwright:
  book free, book paid w/ Stripe test card, cancel, reschedule, embed popup + inline, mobile). CI
  runs all.
- R10 **Rate limiting & abuse.** Per-IP limits on booking/availability/cancel; honeypot on booking
  form; optional block list (email/domain).

## A. Event types (booking links)

- A1 P0 One-on-one event type: name, slug, description (markdown), duration, color, active toggle.
- A2 P0 Scheduling window: rolling N calendar days, rolling N business days (Mon–Fri; the owner's
  live Calendly is "7 business days": on Tue 09-22 after hours it offered Wed 09-23 → Thu 10-01),
  fixed date range, or indefinite. Today counts as day 0 and is bookable on top of the N days.
- A3 P0 Minimum notice (minutes/hours/days).
- A4 P0 Start-time increment independent of duration (15/20/30/60 or custom).
- A5 P0 Buffers before and after, independently.
- A6 P0 Location: Google Meet (auto-created), plus P1: Zoom/other static video link, phone
  (invitee provides number, or host number shown), in-person (address), custom text, "invitee
  chooses from these options".
- A7 P0 Price (optional) + currency; free when empty.
- A8 P0 Invitee questions: types short text, long text, single choice (radio), multi choice
  (checkboxes), dropdown, phone; required flag; up to 10; reorderable. Name + email always.
- A9 P0 Confirmation behaviour: built-in confirmation page (default) or redirect URL, with
  optional pass-through of booking details as query params.
- A10 P1 Limits: max bookings per day and per week (per event type).
- A11 P1 Multiple durations on one link (invitee picks 15/30/60), price per duration.
- A12 P1 Secret link (hidden from brand/profile page, bookable by URL).
- A13 P1 Single-use / one-off links: host generates a link that dies after one booking,
  optionally overriding duration/window/price.
- A14 P1 Guests: invitee may add up to N guest emails (default 10, toggle).
- A15 P1 Duplicate event type.
- A16 P2 Group events (capacity > 1 per slot) — changes the overlap invariant; later.
- A17 P1 Require email-verified booking? → P2.
- P2: group events, round robin, collective, team events, meeting polls, meeting packages, PayPal.

## B. Availability

- B1 P0 Named schedules (weekly hours, multiple intervals per day, schedule timezone); each event
  type uses a schedule. Seed: "Working hours" Mon–Fri 09:30–16:00 America/Chicago.
- B2 P0 Date overrides: mark a date unavailable or give it custom hours.
- B3 P1 Vacation / pause mode: pause all bookings (or a date range) with one toggle; links show a
  friendly "not taking bookings" state instead of an empty calendar.
- B4 P1 "Why is this time unavailable?" troubleshooter in admin: for a chosen date shows each
  candidate slot and the reason it's excluded (outside hours, notice, window, buffer, limit,
  booking, Google busy — with the busy calendar name).
- B5 P2 Public-holiday calendars (date overrides cover it).

## C. Calendar

- C1 P0 Google Calendar OAuth (least scopes: events + freebusy + calendarlist readonly).
- C2 P0 Conflict check across multiple selected calendars of the connected account (list via
  calendarList; primary selected by default).
- C3 P0 Destination calendar selectable (primary default).
- C4 P0 Only busy events block (transparency=transparent / "Free" ignored); all-day busy events
  block the day; declined events ignored (freebusy semantics).
- C5 P0 Created event: title "{event} — {invitee}", description with answers + cancel/reschedule
  links, invitee (and guests) as attendees so Google sends the invite, Meet link auto.
- C6 P0 Reschedule updates the same Google event; cancel deletes it (Google notifies attendees).
- C7 P2 Outlook/Microsoft 365, iCloud CalDAV, multiple Google accounts (CalendarPort seam kept).

## D. Booking page (invitee UX)

- D1 P0 Month calendar with available days, slot list for chosen day, confirm form, success
  screen. Works as full page, inline embed, and popup embed.
- D2 P0 Invitee timezone auto-detected, switchable (searchable list); 12h/24h toggle
  (auto from locale).
- D3 P0 Mobile-first, no nested scroll traps, fast (availability fetched per month, cached briefly).
- D4 P0 Accessible: full keyboard navigation of calendar + slots, ARIA labels, visible focus,
  WCAG AA contrast in light and dark.
- D5 P0 Prefill via URL params: `name`, `email`, `a1..a10` (answers), `guests`; Calendly-compatible
  names accepted too (`first_name`, `last_name`).
- D6 P0 UTM capture: `utm_source/medium/campaign/content/term` + `ref`/`src` from the link or
  parent page, stored on the booking.
- D7 P0 Success screen: date/time in invitee tz, location/Meet link, add-to-calendar (Google,
  Outlook, .ics), reschedule/cancel links.
- D8 P0 Branding per brand: name, logo/avatar, accent color, light/dark/auto theme; "Powered by
  BookKit" optional.
- D9 P1 Brand profile page listing its public event types (link-in-bio target).
- D10 P1 `hide_details=1` / `hide_gdpr_banner` style embed params; `theme=dark|light`,
  `accent=` override for embeds.
- D11 P1 Social share previews: per-link OpenGraph/Twitter image generated on the fly (title,
  duration, price, host avatar).
- D12 P2 Translations (i18n strings centralized so it's possible later).

## E. Payments (Stripe)

- E1 P0 Charge at booking via embedded Stripe Payment Element (cards, Apple/Google Pay, Link)
  on the same panel; hosted Checkout fallback.
- E2 P0 Hold + expiry + idempotent webhook + crosstalk safety + auto-refund on conflict (see R3).
- E3 P0 Receipts via Stripe; amount + payment status visible in admin; refund button in admin.
- E4 P1 Cancellation refund policy per event type: full refund if invitee cancels ≥ X hours
  before start, none after (or no refunds); policy text shown before paying; host-initiated
  cancel always refunds in full.
- E5 P1 Coupons: Stripe promotion codes accepted on the booking form; 100% off skips payment.
- E6 P2 Deposits, packages, invoices, PayPal.

## F. Notifications

- F1 P0 Invitee confirmation email (HTML + text, .ics attached, Meet link, cancel/reschedule links)
  in addition to the Google invite.
- F2 P0 Host "new booking" email with answers, UTM source, payment.
- F3 P0 Cancel + reschedule emails to both sides (with reason).
- F4 P1 Reminders: per-event-type offsets (default 24h and 1h before) to invitee; skipped if
  cancelled; sent by cron with outbox semantics (never twice).
- F5 P1 Follow-up email X hours after the meeting (optional template).
- F6 P1 Editable templates with variables ({invitee_name}, {event_name}, {start_local},
  {location}, {cancel_url}, {reschedule_url}); safe defaults.
- F7 P1 Email transport: Resend by default, SMTP alternative; configurable from-name/address.
- F8 P2 SMS.

## G. Cancel / reschedule

- G1 P0 Invitee self-service cancel + reschedule via unguessable per-booking token links.
- G2 P0 Reason captured (optional text) and shown to host.
- G3 P1 Cutoff: no invitee cancel/reschedule within X hours of start (per event type); page shows
  the policy and a contact line instead.
- G4 P0 Reschedule keeps payment; picks a new slot with the same rules; same Google event updated.
- G5 P0 Host cancel / reschedule from admin, with notify toggle and message.
- G6 P1 Mark no-show (host), undoable; recorded in analytics/webhooks.

## H. Embeds & sharing (integrate anywhere)

- H1 P0 One `<script src="https://BOOKKIT/embed.js">` supporting: popup on any element
  (`data-bookkit="slug"`), inline (`<div data-bookkit-inline="slug">`), floating badge button
  (`BookKit.badge({...})`), and JS API `BookKit.open(slug, {prefill, utm})`.
- H2 P0 Auto-resize inline iframes; popup modal with focus trap, Esc to close, scroll lock,
  mobile full-screen sheet.
- H3 P0 postMessage events to parent with origin checks: `bookkit:ready`, `bookkit:date_selected`,
  `bookkit:slot_selected`, `bookkit:booked` (booking id, start, event slug), `bookkit:height`;
  also dispatched as DOM CustomEvents on `window` for GTM/pixel wiring.
- H4 P0 Parent page UTMs auto-forwarded into the embed.
- H5 P0 Plain link + plain iframe work with no JS.
- H6 P1 React component (`<BookKitButton slug>` / `<BookKitInline slug>`) as a copy-paste file in
  the repo (`integrations/react/BookKit.tsx`) — no npm publish needed.
- H7 P1 Admin "Share" panel per link: URL, popup/inline/badge/iframe/React snippets with copy
  buttons, QR code (PNG/SVG download), link-in-bio URL with UTM builder.
- H8 P1 Calendly drop-in: embed.js also upgrades existing Calendly markup
  (`.calendly-inline-widget[data-url]`, `Calendly.initPopupWidget({url})`) when a mapping is
  configured — lets a site swap by changing one script tag.
- H9 P1 Docs: Next.js, plain HTML, Webflow, Framer, WordPress, Squarespace, link-in-bio (IG/TikTok/
  X/LinkedIn), email signature.
- H10 P0 `frame-ancestors` allowlist config (default `*` for embeds).

## I. API, webhooks, agents

- I1 P0 Outbound webhooks: `booking.created`, `booking.cancelled`, `booking.rescheduled`,
  `booking.paid`, `booking.no_show`; HMAC-SHA256 signed with timestamp header
  (`BookKit-Signature: t=..,v1=..`); retries via outbox; delivery log in admin; multiple endpoints.
- I2 P1 REST API with API keys (hashed at rest): list event types, get availability, create
  booking (free types), get/cancel/reschedule booking, list bookings. OpenAPI spec at
  `/api/v1/openapi.json`.
- I3 P1 MCP server endpoint (`/api/mcp`, streamable HTTP, API-key auth) exposing
  `list_event_types`, `find_available_times`, `book_meeting`, `cancel_booking`,
  `list_upcoming_bookings` — lets Claude/ChatGPT agents book you.
- I4 P2 Zapier/Make apps (webhooks + API cover it).

## J. Admin

- J1 P0 Password login (bcrypt/scrypt hash or env), signed HTTP-only session, login rate limit.
- J2 P0 Bookings: upcoming / past / cancelled / needs-attention tabs, search, detail page
  (answers, UTM, payment, Google link, audit log, resend emails, retry side effects).
- J3 P0 Event type editor with live preview; schedules editor with date overrides.
- J4 P0 Settings: brands, Google connection + calendar selection, email, notifications,
  webhooks, API keys, embed allowlist.
- J5 P0 Needs-attention queue: failed side effects, calendar drift, payment conflicts, with retry.
- J6 P1 Analytics: views → started → booked funnel per link, bookings by source/UTM, revenue,
  cancellations/no-shows, last 7/30/90 days.
- J7 P1 CSV export of bookings.
- J8 P1 Brands: multiple brands (e.g. buildwithneej, goalphaflow), each with its own name, logo,
  accent, profile slug, reply-to email; event types belong to a brand.

## K. Privacy & data

- K1 P0 No third-party trackers or cookies on booking pages by default.
- K2 P1 Delete all data for an email (bookings anonymized, Google events untouched); export JSON.
- K3 P1 Optional privacy-policy link + consent checkbox on the booking form.

## L. Open source / DX

- L1 P0 `git clone && npm i && npm run setup` interactive setup: checks env, runs migrations,
  seeds a schedule + event type, prints next steps. Docker Compose Postgres for local.
- L2 P0 Env validated at boot with human error messages; Stripe/Resend optional (features degrade
  cleanly, admin shows what's off).
- L3 P1 Deploy-to-Vercel button + docs; works on any Node host (Docker image).
- L4 P0 README: 20-minute self-host, embed guide, migrate-from-Calendly guide, architecture,
  reliability guarantees and how they're enforced.
- L5 P1 `npm run import:calendly` — imports event types (name, slug, duration, description,
  window, questions, price) from a Calendly public profile URL.
- L6 P0 MIT license, CONTRIBUTING, SECURITY, CI green.
- L7 P1 Demo mode (in-memory calendar, daily reset) for a public demo instance.

## M. Owner rollout (P0, local first)

- M1 Brands `buildwithneej` and `alphaflow`. Event types: `strategy-call` ($69, 30 min, rolling
  7 days, Meet, 1 optional long-text question) on buildwithneej; `alphaflow-consulting-intake`
  (free, 30 min, rolling 7 days, Meet, same question) on alphaflow; `general-meeting-neej`
  (free, secret, 60 days) on buildwithneej. Schedule Mon–Fri 09:30–16:00 America/Chicago, 30-min
  increments.
- M2 buildwithneej.com and goalphaflow.com swap every Calendly link/embed for BookKit, locally,
  on branches — no prod push without explicit owner approval.
- M3 Parallel soak: Calendly stays live until BookKit has taken real bookings on both sites for
  a week with zero incidents; then cancel Calendly.
