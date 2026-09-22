# v2 integrations checklist

1. **Embed script + React drop-in** — `public/embed.js` (popup/inline/badge/JS API,
   accessible modal, skeleton loading, origin-checked postMessage, UTM forwarding,
   Calendly drop-in shim) and `integrations/react/BookKit.tsx`
   (`BookKitButton`/`BookKitInline`/`useBookKitEvent`). `public/widget.js` untouched.
2. **REST API v1** — `app/api/v1/**` (event-types, availability, bookings CRUD +
   cancel/reschedule, openapi.json), `lib/api-auth.ts`, `lib/openapi.ts`. Reuses
   `parseBookingRequest`/`publicBooking`/booking-engine functions, so every entry
   point validates identically.
3. **MCP server** — `app/api/mcp/route.ts` + `lib/mcp/tools.ts`. Streamable HTTP,
   JSON-only, 6 tools, same auth and booking-engine reuse as the REST API.
4. **Calendly importer** — `scripts/import-calendly.ts`. Verified against the
   owner's real profile (`--dry-run` output matches the documented expectation:
   7 business days on the two public event types, Mon–Fri 09:30–16:00
   America/Chicago, 30-min increments, $69 on strategy-call), and a real
   non-dry-run import/cleanup round-trip against the local worktree DB.
5. **Docs** — `docs/{EMBED,API,WEBHOOKS,MIGRATE-FROM-CALENDLY,RELIABILITY,MCP}.md`,
   `.github/workflows/cron-tick.yml` (disabled by default), `vercel.json` cron
   entry for `/api/cron/tick` every 10 minutes.
6. **Tests** — `docs/examples/embed-test.html` + a Playwright run against the
   local dev server (popup/inline/badge/JS API/Calendly drop-in, embed_id +
   UTM forwarding, same-origin resize honoured, cross-origin resize ignored —
   all passed). `tests/integration/api-v1.test.ts` (12 tests) and
   `tests/integration/mcp.test.ts` (18 tests), both green.
