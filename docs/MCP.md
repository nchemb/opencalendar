# MCP — let an AI agent book you

OpenCalendar exposes an [MCP](https://modelcontextprotocol.io) server at `/api/mcp`
so Claude, ChatGPT, or any MCP-capable agent can check your availability and
book, cancel or reschedule meetings on your behalf.

- **Transport:** Streamable HTTP, JSON responses only (no SSE stream — every
  call gets a single JSON reply).
- **Protocol version:** `2025-06-18` (also accepts `2025-03-26`).
- **Auth:** the same API key as the REST API — `Authorization: Bearer bk_live_...`.
  Create one in `/admin/settings/api-keys`.

## Tools

| Tool | What it does |
|---|---|
| `list_event_types` | Lists every bookable link — name, slug, duration, price. Call first. |
| `find_available_times` | Open slots for one event type in a date range, in a given timezone. |
| `book_meeting` | Books a free event type at an exact slot. Paid types return the booking page URL instead — the agent can't take payment. |
| `cancel_booking` | Cancels by booking id. Refunds automatically if it was paid. |
| `reschedule_booking` | Moves a booking to a new open slot. |
| `list_upcoming_bookings` | Lists confirmed upcoming bookings. |

Every tool reuses the exact same validation and booking-engine code as the
booking page and the REST API (`lib/booking.ts`, `lib/booking-request.ts`) — an
agent can never book something the UI couldn't.

## Claude Code

```bash
claude mcp add --transport http bookkit https://your-instance.example.com/api/mcp \
  --header "Authorization: Bearer bk_live_..."
```

## Claude Desktop

Add to your MCP config (`claude_desktop_config.json` doesn't support remote
HTTP servers directly yet — use a local proxy like `mcp-remote`):

```json
{
  "mcpServers": {
    "bookkit": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://your-instance.example.com/api/mcp",
        "--header",
        "Authorization: Bearer bk_live_..."
      ]
    }
  }
}
```

## Generic MCP client

Any client that speaks Streamable HTTP just needs the URL and the header:

- Endpoint: `POST https://your-instance.example.com/api/mcp`
- Header: `Authorization: Bearer bk_live_...`
- Send `initialize`, then `notifications/initialized`, then `tools/list` and
  `tools/call` as normal JSON-RPC 2.0 requests.

```bash
curl -X POST https://your-instance.example.com/api/mcp \
  -H "Authorization: Bearer bk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"find_available_times","arguments":{"slug":"strategy-call","from":"2026-10-01","to":"2026-10-07"}}}'
```

## Errors

A tool failure (bad slug, slot just taken, calendar disconnected) comes back
as a normal JSON-RPC result with `isError: true` and a human-readable message
in `content` — not a protocol-level error — so the agent can read it and try
something else. Protocol-level problems (bad auth, unknown method, malformed
JSON-RPC) use standard JSON-RPC error codes.
