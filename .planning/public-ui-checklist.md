# BookKit v2 public UI — checklist

1. **`/[slug]` + `/embed/[slug]` booking flow** — done. `components/booking/BookingWidget.tsx`
   orchestrates details → calendar → times → form → payment → confirmation, sharing one
   `CalendarAndSlots` for both. Durations, locations, all 6 question types, guests, prefill,
   UTM, paused/blocked/503/409 handling, single-use links, redirect all wired.
2. **`/booking/[token]` manage page** — done. `app/booking/[token]/page.tsx` + `ManageView.tsx`:
   view / reschedule (reuses `CalendarAndSlots`) / cancel with reason, `?action=` deep link,
   policy gating, refund outcome. `/cancel/[token]` redirects here.
3. **`/success` hosted-Checkout return** — done. Polls `/api/bookings/[id]?t=` until CONFIRMED
   (or a terminal status), 60s timeout falls back to "still confirming" instead of spinning
   forever, then renders the shared `Confirmation` component.
4. **`/u/[brand]` profile page** — done. Lists active, non-secret meeting types with duration/price,
   brand/host avatar, tagline, website link.
5. **OpenGraph images + metadata** — done. `app/[slug]/opengraph-image.tsx`,
   `app/u/[brand]/opengraph-image.tsx`, `generateMetadata` on both routes with canonical URLs.
6. **`/` instance home** — done, minimally: added an early redirect to `/u/<brand>` when there is
   exactly one brand, on top of the existing OSS marketing homepage (kept as the multi/zero-brand
   fallback rather than deleted, since it predates this task and is out of scope to remove).
7. **Embed protocol (`docs/EMBED-PROTOCOL.md`)** — done. `lib/ui/embed.ts` emits every `bookkit:*`
   message plus the v1 dotted names, `bookkit:ready` on first availability load/fail, height via
   ResizeObserver, `bookkit:parent_utm` accepted only from `document.referrer` origin, `hide_details`
   collapses the details panel, theme/accent overrides.

Analytics: `bumpMetric(..., "view")` fires server-side on `/[slug]` and `/embed/[slug]` (skipping
bot user agents), `"slot"` fires via `POST /api/analytics/slot` when a time is picked.
