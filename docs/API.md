# REST API v1

Base URL: `https://your-instance.example.com/api/v1`. Full machine-readable spec
at `GET /api/v1/openapi.json` (no auth required, so tooling can discover it).

## Auth

Every endpoint except `openapi.json` needs an API key, created in
`/admin/settings/api-keys`:

```
Authorization: Bearer bk_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

Keys are stored hashed — BookKit shows you the token once, at creation. A
revoked or unknown key gets `401 { ok: false, error, code: "UNAUTHORIZED" }`.

## Response shape

Every response is `{ ok: boolean, data?: ..., error?: string, code?: string }`.
CORS is open (`Access-Control-Allow-Origin: *`) since the API is key-authed,
not cookie-authed — call it from a browser or a server.

## Rate limits

300 req/min/key on reads, 30 req/min/key on writes (booking, cancel,
reschedule). A `429` includes `code: "RATE_LIMITED"`.

## Endpoints

### `GET /event-types`

Every active event type, including secret ones — API keys see everything a
direct link would.

```bash
curl https://your-instance/api/v1/event-types \
  -H "Authorization: Bearer bk_live_..."
```

### `GET /event-types/{slug}/availability`

```
?from=2026-10-01&to=2026-10-07&tz=America/Chicago&duration=30
```

`from`/`to` are dates (inclusive), at most 70 days apart. `tz` defaults to the
event type's schedule timezone. `duration` only matters for event types that
offer more than one. Returns UTC ISO instants.

### `POST /bookings`

Free event types only — a paid type returns `402` with `data.bookingUrl`
pointing at the hosted booking page, since the invitee has to actually pay
there.

```bash
curl -X POST https://your-instance/api/v1/bookings \
  -H "Authorization: Bearer bk_live_..." -H "Content-Type: application/json" \
  -d '{
    "slug": "intro-call",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "timezone": "America/New_York",
    "startTime": "2026-10-02T14:00:00.000Z"
  }'
```

`answers` (object keyed by question id), `guests` (array of emails),
`location`, `durationMinutes` and `utm` are all optional — same fields the
booking page itself sends. A slot someone else just took comes back `409` with
`code: "SLOT_TAKEN"`.

### `GET /bookings`

```
?status=CONFIRMED&from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z&email=ada@example.com&limit=25&cursor=...
```

Cursor-paginated, newest `startTime` first. `data.nextCursor` is `null` on the
last page.

### `GET /bookings/{id}`

### `POST /bookings/{id}/cancel`

Acts as the host — no invitee cutoff, and refunds a paid booking by default.

```bash
curl -X POST https://your-instance/api/v1/bookings/abc123/cancel \
  -H "Authorization: Bearer bk_live_..." -H "Content-Type: application/json" \
  -d '{"reason": "Host unavailable", "notify": true, "refund": true}'
```

### `POST /bookings/{id}/reschedule`

Also acts as the host — may move to any slot that's actually free, ignoring
the invitee's cutoff window.

```bash
curl -X POST https://your-instance/api/v1/bookings/abc123/reschedule \
  -H "Authorization: Bearer bk_live_..." -H "Content-Type: application/json" \
  -d '{"startTime": "2026-10-03T15:00:00.000Z"}'
```

## Also see

- `docs/MCP.md` — same booking engine, exposed to AI agents over MCP.
- `docs/WEBHOOKS.md` — get pushed to instead of polling `GET /bookings`.
