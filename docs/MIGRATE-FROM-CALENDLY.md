# Migrating from Calendly

## 1. Import your event types

```bash
npm run import:calendly -- https://calendly.com/your-profile --dry-run
```

Review the plan, then run it for real (drop `--dry-run`, optionally add
`--brand <slug>` to attach the imported types to a brand you've already set
up). It's idempotent — re-run it any time to pull in changes you've made on
Calendly, matched by slug.

What it imports: name, slug, description, duration, price/currency,
locations, invitee questions, and the scheduling window (calendar vs.
business days), all read directly from Calendly's own public booking API — no
Calendly API key needed. Weekly hours and the start-time increment are
inferred from ~30 days of your actual open slots. What it can't see: minimum
notice, buffers, and daily/weekly limits aren't exposed by that API at all —
check those in `/admin` after import. Secret links never appear in a public
profile, so they aren't importable; recreate them by hand.

## 2. Swap the embed

If your site uses Calendly's widget:

```html
<script src="https://assets.calendly.com/assets/external/widget.js"></script>
```

change it to BookKit's, and add a map from each Calendly URL to the matching
BookKit slug — `embed.js` upgrades your existing `.calendly-inline-widget`
divs and `Calendly.initPopupWidget(...)` calls automatically, so you don't
have to touch the markup:

```html
<script>
  window.BOOKKIT_CALENDLY_MAP = {
    "https://calendly.com/your-profile/strategy-call": "strategy-call",
  };
</script>
<script src="https://your-instance.example.com/embed.js" defer></script>
```

`<a href="https://calendly.com/your-profile/strategy-call">` links that appear
in your mapping also get intercepted and opened as BookKit popups. Once
you've verified everything, you can migrate the markup itself to native
BookKit (`data-bookkit-popup="strategy-call"`) — see `docs/EMBED.md` — and
drop the map.

## 3. Run both in parallel for a week

Keep the Calendly link live somewhere (a low-traffic page, or just don't
cancel the Calendly plan yet) while BookKit takes real bookings from your main
site and socials. Check `/admin` daily: bookings landing correctly, calendar
events created, confirmation emails sending, no entries in the
needs-attention queue. `docs/RELIABILITY.md` explains what's being checked
and how to get alerted if something breaks.

Only cancel Calendly once BookKit has taken real bookings on every site you
moved, with zero incidents, for at least a week.

## What BookKit does that Calendly doesn't

- **Enforced cancellation cutoff** — Calendly's cancellation policy is just
  text on the page; nothing stops an invitee cancelling one minute before a
  meeting. BookKit's `cancelCutoffHours` actually blocks it.
- **Automatic refunds** — Calendly never processes refunds; you do it by hand
  in Stripe. BookKit refunds automatically on a policy-eligible cancel, and on
  the rare post-payment slot conflict.
- **QR codes** — generate one per booking link from `/admin`, no separate
  tool.
- **No per-seat pricing** — one deploy, unlimited event types and brands, no
  "unlock unlimited event types" upsell.
- **Self-hosted data** — every booking, answer and webhook lives in your own
  Postgres. Nothing about your invitees passes through a third party.

## What Calendly has that BookKit (v2) doesn't

Group/round-robin/collective events, meeting polls, Outlook/iCloud calendar
sync, SMS reminders, and routing forms are out of scope for this version — see
`docs/REQUIREMENTS.md`'s P2 list. If you rely on any of those, don't cancel
Calendly yet.
