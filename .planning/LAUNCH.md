# BookKit v2 — launch checklist (owner)

State 2026-09-22: v2 built on branch `v2` (bookkit repo), 257 unit+integration tests green, full local
E2E proven: $69 strategy call paid with Stripe test card through the buildwithneej popup, free
AlphaFlow intake booked through the goalphaflow inline embed, missed-webhook payment recovered by cron.
Nothing pushed or deployed.

## Needs you (in order)

1. **Database that never pauses.** The Aug Supabase project `jlkjwnfqklajjfbltpvs` is INACTIVE (free
   tier auto-paused). A paused DB = every booking page down. Pick one:
   - Supabase Pro ($25/mo, no pausing) → restore the project, or
   - Neon free (scales to zero, wakes in ~1s, never deleted for inactivity).
   Then `DATABASE_URL`/`DIRECT_URL` in Vercel prod and `npx prisma migrate deploy`.
2. **Vercel env (project `bookkit`)**: `CRON_SECRET` (random), `TOKEN_ENCRYPTION_KEY`
   (`openssl rand -base64 32`), `ALERT_WEBHOOK_URL` (ntfy.sh topic → phone push, free),
   `RESEND_API_KEY` + `RESEND_FROM` (domain must be verified in Resend), `ADMIN_EMAIL=neej@goalphaflow.com`.
   Remove `BOOKKIT_CALENDAR` if present. Keep Google OAuth vars.
3. **Cron.** `vercel.json` ticks every 10 min — needs Vercel Pro. On Hobby, enable
   `.github/workflows/cron-tick.yml` (set repo vars `BOOKKIT_URL`, secret `CRON_SECRET`).
4. **Stripe live**: restricted key (Touch ID wall from Aug) → `STRIPE_SECRET_KEY`,
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`; webhook endpoint → `/api/stripe/webhook` with
   `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`.
5. **DNS**: CNAME `book` → `cname.vercel-dns.com` on buildwithneej.com (Namecheap). Then set
   `NEXT_PUBLIC_APP_URL` + `GOOGLE_REDIRECT_URI` to `https://book.buildwithneej.com` and add the
   redirect URI to the Google OAuth client.
6. **Deploy BookKit** (merge `v2` → `main`, push). Log in `/admin` → Settings → reconnect Google →
   pick conflict calendars (every calendar that holds real meetings).
7. **Load config**: `npm run import:calendly -- https://calendly.com/buildwithneej --brand buildwithneej`
   against prod, then in /admin: create brand `alphaflow` (#06B6D4) and assign the intake to it,
   mark `general-meeting-neej` secret, set cancel cutoff 12h / refund before cutoff, check min notice.
8. **Real money test**: book the $69 call yourself on prod, confirm Google invite + Meet link +
   emails, cancel from the manage link → automatic refund.
9. **Site swaps** (branches ready, not pushed):
   - buildwithneej: `bookkit-v2-swap` (`.claude/worktrees/bookkit-v2`). Set
     `BOOKKIT_WEBHOOK_SECRET` from a BookKit webhook endpoint pointed at
     `https://buildwithneej.com/api/bookkit-webhook` (keeps adding bookers to the Resend AI audience).
   - goalphaflow: `bookkit-v2-swap` (`../alphaflow-bookkit-v2`).
10. **Soak one week** with Calendly still paid. Zero incidents → cancel Calendly.

## Content angle
"I replaced Calendly with an open-source tool I built in a day" — receipts: 257 tests, the lock-based
double-booking proof, auto-refund on cancel (Calendly can't), agents booking you over MCP,
`import:calendly` one-command migration. Flip the repo public at launch.
