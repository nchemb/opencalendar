---
tags: [sessions]
project: bookkit
updated: 2026-08-06
---

# bookkit Sessions

Consolidated session log. Updated by /compress.

---

## 2026-08-06 00:20 — BookKit built from zero: OSS Calendly replacement, deployed + live-verified

**Outcome:** Full self-hosted booking tool (Next.js 14 + Prisma/Supabase + Google Calendar + Stripe + Resend) built, deployed to Vercel, and live-verified end-to-end for free bookings; paid pipeline verified to the card-swipe boundary. Private repo `nchemb/bookkit` (MIT, self-host README).

**Decisions:**
- Google Calendar invite = primary confirmation channel; booking never CONFIRMED without an event id
- Overlap safety via `pg_advisory_xact_lock(hashtext(hostId))` inside a Serializable tx that re-checks DB overlaps + live freebusy at commit; partial unique index only as belt-and-braces
- No cron: pending holds expire lazily (`expiresAt < now()` treated as free) + Stripe expired webhook
- Paid UX: inline Stripe Payment Element (intent flow) on the same panel — no redirect; hosted Checkout kept as OSS fallback when publishable key unset
- DB hold (33 min) always outlives Stripe session (31 min)
- Live Stripe on shared AlphaFlow LLC account: webhook ignores unknown sessions/intents (crosstalk-safe)
- Questions system: up to 5 per meeting type w/ required flags (JSON), answers stored structured + display string; legacy customQuestion backfilled by migration
- Layout: container queries (`@container`/`@xl:`) not viewport breakpoints — embeds are iframes where viewport = iframe

**Key Learnings:**
- Prisma `$queryRaw` cannot deserialize `void` → `pg_advisory_xact_lock(...)::text` cast required (every booking 500'd until found)
- Chrome DevTools device emulation drops clicks into cross-origin iframes — test embeds on real phones
- Nested scrollboxes inside embed iframes = touch scroll traps; stacked mobile layout must flow full height + parent resizes via postMessage
- Stripe dashboard restricted-key creation gated by identity verification (Touch ID) — cannot be automated

**Files Modified:**
- Whole repo (69+ files): `lib/booking.ts` (reservation tx, finalizers, conflict auto-refund), `lib/availability.ts` (DST-safe Luxon slot engine), `lib/google.ts` (OAuth + freebusy + event retry), `app/api/*` (11 routes), `components/booking/BookingFlow.tsx` + `PaymentStep.tsx`, `public/widget.js` (popup modal + inline auto-mount + resize), `/admin` dashboard (meeting-type CRUD w/ questions repeater, bookings, settings), 22 unit tests

**Pending:**
- [ ] Neej: Touch ID the open Stripe dialog → restricted live key "BookKit" → I wire + redeploy
- [ ] Neej: one real $69 booking → instant MCP refund (final E2E proof)
- [ ] Neej: Namecheap CNAME `book` → `cname.vercel-dns.com`; then flip APP_URL/redirect envs + webhook endpoint URL
- [ ] Neej: approve prod push of buildwithneej + alphaflow-site migration branches
- [ ] Flip repo public at content launch

---
