# Security

## Reporting a vulnerability

Please do not open a public issue.

Report privately through
[GitHub's advisory form](https://github.com/nchemb/opencalendar/security/advisories/new),
which is the fastest route and keeps the disclosure private until there is a fix.

Include what you did, what happened, and what you expected. A proof of concept
against a local instance is ideal. Expect an acknowledgement within a few days.

OpenCalendar is maintained by one person as a side project, with no paid support and
no bounty programme. Fixes for anything that exposes booker data or lets an
unauthenticated caller act as the host will be prioritised over everything else.

## What OpenCalendar assumes about your deployment

Self-hosting means these are yours to get right:

- **`ADMIN_PASSWORD` is the only thing between the internet and your dashboard.**
  There is no second factor and no account system — one host, one password. Use
  a long random one. It also signs the session cookie, so changing it logs you
  out everywhere, which is the intended way to revoke a session.
- **Serve over HTTPS.** The session cookie is `Secure` in production, so admin
  login simply will not work over plain HTTP — that is deliberate.
- **`DATABASE_URL` and every secret belong in your host's environment**, never in
  the repo. `.env` is gitignored; keep it that way.
- **Rate limiting is per-instance and in-memory.** It blunts casual abuse of the
  public booking endpoints. It is not a defence against a distributed attack —
  put Cloudflare or your host's protection in front if that is a concern.
- **The Stripe webhook is signature-verified**, and a shared Stripe account
  serving several products is expected: unknown sessions are acknowledged and
  ignored rather than acted on.

## Scope

In scope: authentication bypass, booking data exposure, unauthenticated writes,
injection, and anything that lets one booker see or change another's booking.

Out of scope: missing rate limits on non-mutating endpoints, self-XSS,
vulnerabilities in a fork's own modifications, and anything requiring access to
the host's own machine or database.
