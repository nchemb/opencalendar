# Embedding BookKit

One script, `embed.js`, covers every style below. Full contract (URL params,
postMessage events, the JS API): `docs/EMBED-PROTOCOL.md`.

```html
<script src="https://your-instance.example.com/embed.js" defer></script>
```

If your CDN, proxy, or a bundler strips or rewrites the script's own `src` (so
embed.js can't work out which instance loaded it), pin it explicitly instead —
this is also required if `document.currentScript` isn't available in your
setup:

```html
<script src="/proxied/embed.js" data-bookkit-origin="https://your-instance.example.com" defer></script>
```

Without one of those two, embed.js refuses to mount (logs a console error)
rather than guess — it never trusts the page it's running on as the origin.

## Popup

```html
<button data-bookkit-popup="strategy-call">Book a call</button>
<!-- or a real link, with a working href for JS-disabled visitors -->
<a href="https://your-instance/strategy-call" data-bookkit-popup="strategy-call">Book a call</a>
```

```js
BookKit.open("strategy-call", {
  prefill: { name: "Ada", email: "ada@example.com" },
  theme: "dark",
});
```

## Inline

```html
<div data-bookkit-inline="strategy-call"></div>
```

Auto-resizes to its content. `data-hide-details="1"`, `data-theme`,
`data-accent` attributes are read the same way as the popup.

## Floating badge

```js
BookKit.badge({ slug: "strategy-call", text: "Book a call", position: "bottom-right" });
```

## Plain link (no JS)

```html
<a href="https://your-instance.example.com/strategy-call">Book a call</a>
```

Every booking link is a full working page on its own — the script is
progressive enhancement, not a requirement.

## React

Copy `integrations/react/BookKit.tsx` into your app — see
`integrations/react/README.md`.

```tsx
<BookKitButton baseUrl="https://your-instance" slug="strategy-call">Book a call</BookKitButton>
<BookKitInline baseUrl="https://your-instance" slug="strategy-call" />
```

## Events / GTM / pixel wiring

Every embed event is also a `CustomEvent` on `window`, so you don't need the
JS API just to track conversions:

```js
window.addEventListener("bookkit:booked", (e) => {
  console.log(e.detail); // { bookingId, startTime, endTime, name, email, paid }
  gtag("event", "generate_lead", { value: e.detail.paid ? 1 : 0 });
  // or push to GTM's dataLayer:
  window.dataLayer?.push({ event: "bookkit_booked", ...e.detail });
});
```

Other events: `bookkit:ready`, `bookkit:date_selected`, `bookkit:slot_selected`,
`bookkit:payment_started`, `bookkit:close`.

## Per-platform notes

**Next.js / React** — use the React drop-in above, or load `embed.js` with
`next/script` (`strategy="lazyOnload"`) and use the vanilla API/markup.

**Plain HTML** — paste the script tag and markup straight into the page.

**Webflow** — Project Settings -> Custom Code -> Footer Code: paste the script
tag. Add the popup button as an HTML embed element with the `data-bookkit-popup`
markup, or an inline embed with the `data-bookkit-inline` div.

**Framer** — add a Code Embed component in "End of body" mode with the script
tag, then another Code Embed wherever the button/div goes.

**WordPress** — a footer script via your theme's `wp_footer` hook, a "Custom
HTML" block, or a code-injection plugin (Insert Headers and Footers, WPCode).
Elementor/Divi: use their HTML widget for the button/div markup.

**Squarespace** — Settings -> Advanced -> Code Injection -> Footer for the
script tag; a Code Block on the page for the button/div markup.

**Wix** — Settings -> Custom Code -> Add Custom Code, load on all pages, place
in Body - end. Use an embed/HTML element for the button/div.

**Shopify** — `theme.liquid`, just before `</body>`, for the script tag; a
Custom HTML/Liquid section for the button/div wherever you want it on a page.

## Link-in-bio

Every event type's plain URL (`https://your-instance/strategy-call`) works
standalone — drop it straight into:

- **Instagram** — bio link, or a Story/Highlight "Link" sticker.
- **TikTok** — bio link (or Linktree-style bio-link tools, same URL).
- **X (Twitter)** — profile website field, or a pinned post.
- **LinkedIn** — Featured section, or the "Website" field on your profile.
- **YouTube** — channel "Links" section, and in every video description.

Add UTM params to tell them apart in analytics/webhooks:
`?utm_source=instagram&utm_medium=bio`.

## Email signature

```html
<a href="https://your-instance/strategy-call?utm_source=email&utm_medium=signature">
  Book a call with me
</a>
```

A plain link works in every mail client. Gmail/Outlook signatures don't run
JS, so this is always a link, never the popup/inline embed.
