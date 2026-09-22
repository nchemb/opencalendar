# Reliability

A missed, lost, or double booking is the one failure this product cannot
have. Every guarantee below is enforced in code, not by convention — see
`lib/booking.ts`'s header comment for the invariants and
`tests/integration/concurrency.test.ts`, `paid-booking.test.ts`,
`calendar-failure.test.ts` for the tests that hold them to it.

## How the guarantees are enforced

**No double booking.** A slot is claimed inside `withHostLock` — a Postgres
advisory lock (`pg_advisory_xact_lock`) on the host, held across a Serializable
transaction that re-checks live bookings AND does a live Google freebusy call
for the exact interval, immediately before insert. Concurrent requests for the
same slot: exactly one wins, the rest get a clean `409`.

**No lost booking.** The booking row commits before any side effect. Calendar
writes, emails, webhooks and reminders all run through a durable **outbox**
(the `Job` table — `lib/jobs.ts`): rows with `attempts`/`runAt`/`lastError`,
claimed with `SKIP LOCKED`, retried with exponential backoff (30s, 1m, 2m, 4m,
... capped at 3h) up to a per-job attempt limit before landing in `/admin`'s
needs-attention queue. A side effect failing never rolls back or hides the
booking itself.

**Paid bookings.** The slot is held (`PENDING_PAYMENT`, with an expiry that
outlives the Stripe session) while the invitee pays. Stripe webhook handling
is idempotent (claimed once via `webhookProcessedAt`) and only acts on
objects this install created — a shared Stripe account's other sites' events
are ignored (`stripeSessionId`/`stripePaymentIntentId` lookups, never a bare
`payment_status` check). If a payment lands after the hold expired and someone
else took the slot, it's auto-refunded and both parties are emailed
(`findPostPaymentConflict`/`handlePostPaymentConflict`). Payment success is
also confirmed by the booking page polling `GET /api/bookings/{id}`, which
pulls Stripe directly (`syncPaymentFromStripe`) if the webhook is late — a
payer is never stranded on a delayed webhook alone.

**Calendar failure is loud.** A revoked/expired Google connection alerts the
host by email (deduped), shows an admin banner, and flips `/api/health` to
degraded. By default, booking stops entirely rather than trust availability it
can't verify (`hostBookingBlocked`).

**Heartbeat / canary + reconcile.** Every 30 minutes, the cron tick checks
that each active public link still returns at least one open slot and that
Google/Stripe/email credentials still work, and compares upcoming confirmed
bookings against their Google events (detects a deleted/moved event, alerts
the host with a one-click "cancel & notify" or "ignore" — never auto-cancels).

**Time correctness.** Everything is stored in UTC. Slot math runs in the
schedule's timezone through Luxon, DST-safe.

## `/api/health`

```bash
curl https://your-instance/api/health
```

`200` with `{ ok: true, checks: {...} }` when the instance can take bookings;
`503` otherwise, with per-check detail (database, calendar, cron, outbox,
alerts, email, payments). Point an uptime monitor (UptimeRobot, Better
Uptime, Pingdom, a Vercel/Grafana check) at this URL and alert on non-200.

## Scheduling `/api/cron/tick`

The tick drains the outbox, releases stale holds, pulls missed payments by
polling Stripe directly, and (every 30 min) runs the canary and reconcile.
Every task inside it is idempotent, so overlapping or missed ticks are
harmless — the only cost of not running it often enough is slower retries and
reminders. Run it at least every 10 minutes. Four ways, pick what fits your
host:

**Vercel Cron** (`vercel.json`, already wired in this repo):

```json
{ "path": "/api/cron/tick", "schedule": "*/10 * * * *" }
```

⚠️ **Vercel's Hobby plan only allows daily crons** — a sub-daily schedule like
this silently gets clamped/rejected on Hobby. Use one of the options below
instead if you're not on Pro.

**GitHub Actions** (`.github/workflows/cron-tick.yml`, included, disabled by
default): set the repo variable `BOOKKIT_URL` to your instance's URL and the
repo secret `CRON_SECRET` to match your deployment's `CRON_SECRET` env var,
and it runs every 10 minutes via `workflow_dispatch`/`schedule`.

**Your own crontab / launchd**, if you're self-hosting on a box you control:

```
*/10 * * * * curl -sf -X POST https://your-instance/api/cron/tick -H "Authorization: Bearer $CRON_SECRET"
```

**An uptime monitor's "hit this URL periodically" feature** — most (UptimeRobot,
Better Uptime) can be pointed at `/api/cron/tick` with a custom header instead
of, or in addition to, monitoring `/api/health`, which doubles as your ping
schedule.

All four call the same endpoint the same way:
`Authorization: Bearer $CRON_SECRET`. `?force=1` runs the 30-minute canary and
reconcile immediately, useful for a manual check.

## Alert channels

Configured in `/admin/settings` — host gets emailed (deduped per incident) on
a calendar disconnect, a post-payment conflict/refund, a stale calendar write,
or a canary/reconcile failure. Every alert also shows in `/admin` until
resolved.
