# BookKit React drop-in

One file, no npm package. Copy `BookKit.tsx` into your app (e.g. `components/BookKit.tsx`)
and import from there.

```tsx
import { BookKitButton, BookKitInline, useBookKitEvent } from "@/components/BookKit";

// Popup button (renders a real <a href> immediately, works before JS loads)
<BookKitButton baseUrl="https://book.you.com" slug="strategy-call">
  Book a call
</BookKitButton>

// Inline, auto-resizing
<BookKitInline baseUrl="https://book.you.com" slug="strategy-call" className="w-full" />

// React to bookings — send a conversion event, redirect, whatever
useBookKitEvent("booked", (detail) => {
  console.log("booked", detail); // { bookingId, startTime, endTime, name, email, paid }
});
```

`baseUrl` is your BookKit instance's URL. Every component lazy-loads `embed.js` from
it once, even if you render several components — see `docs/EMBED-PROTOCOL.md` for
the full option and event contract shared with the vanilla embed.

Requires React 18+ and a bundler that supports JSX/TSX (this file ships as source,
not a build).
