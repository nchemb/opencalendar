# Embed protocol (contract between the booking UI and embed.js)

The booking UI runs in two places: the full page `/<slug>` and the frameable page
`/embed/<slug>`. `public/embed.js` (and v1 `public/widget.js`) mounts the latter in an
iframe. This file is the contract between them. Both sides must follow it exactly.

## URL parameters (both `/<slug>` and `/embed/<slug>`)

| Param | Meaning |
|---|---|
| `name`, `email` | Prefill. Also accepted: `first_name` + `last_name` (joined). |
| `a1`..`a10` | Prefill answers by question position (Calendly-compatible). |
| `q_<questionId>` | Prefill an answer by question id. |
| `guests` | Comma-separated guest emails. |
| `duration` | Preselect a duration (minutes) when the type offers several. |
| `date` | Preselect a day, `yyyy-MM-dd`. |
| `month` | Open the calendar on a month, `yyyy-MM`. |
| `link` | Single-use link token (one-off link). |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `ref`, `src` | Stored on the booking. |
| `hide_details=1` | Hide the left-hand event details panel (compact embeds). |
| `hide_gdpr_banner=1` | Accepted and ignored (no banner exists) for Calendly-compat. |
| `theme=light\|dark\|auto` | Override the brand theme. |
| `accent=RRGGBB` | Override the accent color (no `#`). |
| `tz` | Preselect the invitee timezone (IANA). |
| `embed_id` | Opaque id chosen by embed.js; echoed back in every message so the parent can match iframes. |

## Messages: iframe → parent (`window.parent.postMessage(msg, "*")`)

Every message is an object `{ type, embedId, slug, ...detail }`. `type` values:

| type | detail | when |
|---|---|---|
| `bookkit:ready` | `{}` | UI mounted and first availability loaded (or failed). |
| `bookkit:height` | `{ height }` | Content height in CSS px changed (ResizeObserver). Inline embeds size to this. |
| `bookkit:date_selected` | `{ date }` | Invitee picked a day. |
| `bookkit:slot_selected` | `{ startTime, durationMinutes }` | Invitee picked a time. |
| `bookkit:payment_started` | `{ bookingId }` | Paid flow: card form shown / checkout started. |
| `bookkit:booked` | `{ bookingId, startTime, endTime, name, email, paid }` | Booking CONFIRMED. |
| `bookkit:close` | `{}` | Invitee pressed the UI's own close/done button (popup should close). |

For v1 compatibility the embed page ALSO sends the old dotted names: `bookkit.resize`
(`{height}`), `bookkit.time_selected`, `bookkit.booked`. v1 `widget.js` keeps working.

## Messages: parent → iframe

| type | detail |
|---|---|
| `bookkit:parent_utm` | `{ utm: Record<string,string> }` — UTMs from the host page, merged under URL params. |

The iframe accepts parent messages only from its own `document.referrer` origin (or any
origin when the referrer is unavailable), and never trusts them for anything but UTM
and prefill values.

## embed.js public API (window.BookKit)

```
BookKit.open(slug, { prefill?: {name,email,answers?:Record<id,string>,guests?:string[]}, utm?, duration?, theme?, accent?, hideDetails? })
BookKit.close()
BookKit.inline(element, slug, options)          // mounts an auto-resizing iframe
BookKit.badge({ slug, text?, color?, textColor?, position?: "bottom-right"|"bottom-left" })
BookKit.on(type, handler)                      // type without the "bookkit:" prefix, e.g. "booked"
```

Declarative markup:

```html
<script src="https://BOOKKIT/embed.js" defer></script>
<button data-bookkit-popup="strategy-call">Book a call</button>
<a href="https://BOOKKIT/strategy-call" data-bookkit-popup="strategy-call">Book</a>
<div data-bookkit-inline="strategy-call" data-hide-details="1"></div>
```

Every event is also dispatched on `window` as `CustomEvent("bookkit:<type>", { detail })`
so Google Tag Manager / pixels can listen without the JS API.

Calendly drop-in: when the page has `window.BOOKKIT_CALENDLY_MAP = { "https://calendly.com/you/x": "slug" }`,
embed.js also mounts `.calendly-inline-widget[data-url]` elements and defines
`window.Calendly.initPopupWidget({url})` / `initInlineWidget({url, parentElement})` shims
that route mapped URLs to BookKit.
