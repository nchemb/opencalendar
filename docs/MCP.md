# MCP — let an AI agent book you

OpenCalendar runs two [MCP](https://modelcontextprotocol.io) servers:

- **Public, no key** — `/api/mcp/public`. Any agent (someone's assistant that found
  your site) can list the event types you opted in, find open times and book you.
- **Keyed** — `/api/mcp`. Your own agent, with your API key: everything above plus
  cancel, reschedule and list your upcoming bookings.

## Public endpoint (any agent, no key)

Turn on **"AI agents can book this"** on each event type agents may book
(Admin → Event types). It is off by default, and secret types are never exposed
even with it on.

| Tool | What it does |
|---|---|
| `list_event_types` | The opted-in types: slug, name, durations, price, description, timezone, questions. |
| `find_available_times` | Open slots for one type in a date range — the booking page's availability code. |
| `book_meeting` | Free type: books it for the named invitee, who gets the normal confirmation email and calendar invite. Paid type: books nothing and returns `checkoutUrl`, the booking page with the slot preselected, for a person to pay. |

`book_meeting` takes `slug`, `name`, `email`, `timezone`, `startTime`, and optionally
`durationMinutes`, `answers`, `notes` and `agentName`. It runs through the same lock
and live calendar re-check as a human booking, so two agents (or an agent and a
person) can never land on one slot — the loser gets a "just taken" error.

Limits: 60 requests a minute and 5 booking attempts an hour per IP, and one
upcoming agent-made booking per invitee email per event type. Agent bookings are
tagged `ref=agent` (and `agent_client=<agentName>`) in the booking source, shown in
admin and in your "New booking" email. The endpoint returns nothing a booking page
doesn't already show: no other invitees, no host email, no secret types.

### Discovery

- `GET /llms.txt` — what you offer, the public MCP URL, and how booking works,
  generated from the opted-in types. Every booking page links to it with
  `<link rel="alternate" type="text/plain">`.
- `GET /.well-known/mcp.json` — machine-readable descriptor pointing at the public endpoint.

Point your own site's `llms.txt` at `https://your-instance.example.com/llms.txt` so
agents reading your site find the booking server.

### Connect

Claude Code:

```bash
claude mcp add --transport http rivera-studio https://your-instance.example.com/api/mcp/public
```

Claude (claude.ai / Desktop) and ChatGPT: add a custom connector / remote MCP server
with the URL `https://your-instance.example.com/api/mcp/public` and no authentication.

Any Streamable HTTP client:

```bash
curl -X POST https://your-instance.example.com/api/mcp/public \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_event_types","arguments":{}}}'
```

## Keyed endpoint (your own agent)

- **Transport:** Streamable HTTP, JSON responses only (no SSE stream — every
  call gets a single JSON reply).
- **Protocol version:** `2025-06-18` (also accepts `2025-03-26`).
- **Auth:** the same API key as the REST API — `Authorization: Bearer bk_live_...`.
  Create one in `/admin/settings/api-keys`.

### Tools

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

### Claude Code

```bash
claude mcp add --transport http bookkit https://your-instance.example.com/api/mcp \
  --header "Authorization: Bearer bk_live_..."
```

### Claude Desktop

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

### Generic MCP client

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
