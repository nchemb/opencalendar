# Contributing

BookKit is deliberately a solo-operator tool. The fastest way to get a change
merged is one that keeps it that way — see [Scope](#scope) below.

## Getting set up

You need Node 22+, Docker (for Postgres), and about five minutes.

```bash
git clone https://github.com/nchemb/bookkit.git
cd bookkit
npm install
cp .env.example .env

docker compose up -d          # Postgres on :5433
npx prisma migrate deploy
npm run seed                  # host row + a starter meeting type
npm run dev
```

Set `DATABASE_URL` and `DIRECT_URL` to the docker-compose values commented at the
bottom of `.env.example`. Google and Stripe are optional for most work — see
below.

## Running the tests

```bash
npm run typecheck
npm run lint
npm test                 # unit + integration
npm run test:unit        # pure functions, no database
npm run test:integration # real Postgres, needs docker compose up
npm run test:e2e         # Playwright against a production build
npm run test:all         # everything, in the order CI runs it
```

Integration and end-to-end tests need Postgres running. They create and migrate
their own databases (`bookkit_test`, `bookkit_e2e`) — they never touch your dev
data.

**No test needs a Google account, a Stripe account, or a network connection.**
Both suites run against the in-memory calendar backend, and the end-to-end run
boots the app in demo mode. If you find yourself needing real credentials to
test something, that is a design problem worth raising in an issue.

### The suite refuses to run against live credentials

Vitest loads your `.env` into `process.env`, so on a real install the test
process starts out holding your live Resend and Stripe keys. `tests/helpers/test-env.ts`
scrubs those before every test and aborts the run if a live key, an outbound
webhook URL, or a non-test database is still visible. If you see

```
Refusing to run: RESEND_API_KEY is set (re_…) — the suite would send real email.
```

that guard is doing its job. Do not work around it.

### Watching a browser run

```bash
npm run test:e2e:ui
```

Playwright builds the app and starts its own server. If you already have one on
port 3100 and want to reuse it, set `E2E_REUSE_SERVER=1` — but be sure it was
started with the e2e database, or every page will 404 against an empty one.

## The calendar seam

Nothing outside `lib/google.ts` talks to Google. Everything goes through
`calendar()` in `lib/calendar.ts`, which returns either the Google backend or
the in-memory one (`lib/calendar-memory.ts`).

That is what makes the failure paths testable — you cannot ask the live Google
API to fail on demand, but `memoryCalendarControl.breakFreeBusy()` does it
instantly. To add a backend (CalDAV, Outlook), implement `CalendarPort` and
register it in `calendar()`. Nothing else should need to change.

## What a good pull request looks like

- **One thing.** Separate the refactor from the behaviour change.
- **A test that fails without it.** For a bug fix, write the failing test first;
  a bug that no test reproduces tends to come back.
- **Green CI.** Types, lint, unit, integration, e2e, build.
- **Comments explain why, not what.** The interesting comments in this codebase
  are the ones recording a decision — why the hold is 33 minutes when the Stripe
  session is 31, why availability fails closed. Match that.

If you are changing anything in the "How it stays correct" table in the README,
the matching test must change with it. That table is executable, and it should
stay that way.

## Scope

Things BookKit deliberately does not do: multi-host and round-robin, SMS
reminders, group events, two-way calendar sync, waitlists, teams, billing plans.

These are not on a roadmap, and pull requests adding them will most likely be
declined — not because they are bad ideas, but because every one of them turns a
tool you can read in an afternoon into a product you have to operate. If you
want those, [Cal.com](https://cal.com) is excellent and open source.

Good contributions: bug fixes, additional calendar backends, accessibility
improvements, deployment guides for hosts other than Vercel, and tests for
anything currently untested.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
