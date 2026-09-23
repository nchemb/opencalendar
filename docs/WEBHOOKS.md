# Webhooks

Register endpoints in `/admin/settings/webhooks`. Each one gets its own signing
secret and can subscribe to specific events (default: all).

## Events

| Event | Fires when |
|---|---|
| `booking.created` | A booking is confirmed (free, or paid and settled). |
| `booking.paid` | A paid booking settles — fires alongside `booking.created`. |
| `booking.rescheduled` | A booking moves to a new time. |
| `booking.cancelled` | A booking is cancelled, by either side. |
| `booking.no_show` | The host marks a booking as a no-show. |

## Delivery

`POST` to your URL, JSON body:

```json
{
  "event": "booking.created",
  "createdAt": "2026-10-01T14:03:22.000Z",
  "data": {
    "id": "clx1a2b3c",
    "status": "CONFIRMED",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "guests": [],
    "timezone": "America/New_York",
    "startTime": "2026-10-02T14:00:00.000Z",
    "endTime": "2026-10-02T14:30:00.000Z",
    "previousStartTime": null,
    "location": { "kind": "google_meet" },
    "meetLink": "https://meet.google.com/abc-defg-hij",
    "answers": [{ "id": "q1", "label": "What are you building?", "answer": "A booking tool" }],
    "utm": { "utm_source": "twitter" },
    "amountCents": null,
    "paymentStatus": null,
    "cancelledBy": null,
    "cancelReason": null,
    "noShow": false,
    "manageUrl": "https://your-instance/booking/ck9...token",
    "meetingType": { "slug": "intro-call", "name": "Intro call" },
    "createdAt": "2026-10-01T14:03:20.000Z"
  }
}
```

Headers:

```
Content-Type: application/json
User-Agent: BookKit-Webhooks/2
BookKit-Signature: t=1759345402,v1=5257a869...
```

## Verifying the signature

`v1` is `HMAC-SHA256("<t>.<raw request body>", your_endpoint_secret)`, hex
encoded. Reject anything outside a tolerance window (OpenCalendar's own reference
verifier uses 300s) to block replay.

**Node**

```js
const crypto = require("node:crypto");

function verify(secret, rawBody, header, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 || ""));
}
```

**Python**

```python
import hashlib, hmac, time

def verify(secret: str, raw_body: bytes, header: str, tolerance_sec: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t = int(parts["t"])
    if abs(time.time() - t) > tolerance_sec:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])
```

Use the **raw** request body (before any JSON parsing/re-serialization) — a
re-serialized body won't byte-match what was signed.

## Retries

Delivery is an outbox job: a non-2xx response or a thrown error is retried
with exponential backoff (30s, 1m, 2m, 4m, ... capped at 3h) up to 8 attempts
before it's marked dead and surfaced in `/admin`'s needs-attention queue.
Deliver idempotently on your end too — a retry can arrive after you already
processed the first attempt if your 2xx response was lost in transit.

## Legacy single-URL config

Setting `WEBHOOK_URL` / `WEBHOOK_SECRET` (env or `/admin/settings`) subscribes
one URL to every event, same signature format. Multiple endpoints in
`/admin/settings/webhooks` are additive on top of it.
