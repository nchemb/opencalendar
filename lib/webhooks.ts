/**
 * Outbound webhooks. Each delivery is an outbox job, signed like Stripe:
 *
 *   BookKit-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 *
 * Receivers recompute the HMAC with their endpoint secret and reject stale
 * timestamps (see docs/WEBHOOKS.md). Legacy single-URL settings (WEBHOOK_URL /
 * WEBHOOK_SECRET) are treated as one more endpoint subscribed to everything.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Booking, MeetingType } from "@prisma/client";
import { prisma } from "./db";
import { enqueue, PermanentJobError } from "./jobs";
import { assertPublicUrl, BlockedUrlError } from "./net-guard";
import { getSetting } from "./settings";
import { manageUrl } from "./emails";

export const WEBHOOK_EVENTS = [
  "booking.created",
  "booking.rescheduled",
  "booking.cancelled",
  "booking.paid",
  "booking.no_show",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** Reference verifier — also what the docs tell receivers to do. */
export function verifySignature(secret: string, body: string, header: string, toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bookingPayload(booking: Booking, meetingType: MeetingType) {
  return {
    id: booking.id,
    status: booking.status,
    name: booking.name,
    email: booking.email,
    guests: booking.guests,
    timezone: booking.timezone,
    startTime: booking.startTime.toISOString(),
    endTime: booking.endTime.toISOString(),
    previousStartTime: booking.previousStartTime?.toISOString() ?? null,
    location: booking.location ?? null,
    meetLink: booking.meetLink,
    answers: booking.answers ?? [],
    utm: booking.utm ?? null,
    amountCents: booking.amountCents,
    paymentStatus: booking.stripePaymentStatus,
    cancelledBy: booking.cancelledBy,
    cancelReason: booking.cancelReason,
    noShow: booking.noShow,
    manageUrl: manageUrl(booking),
    meetingType: { slug: meetingType.slug, name: meetingType.name },
    createdAt: booking.createdAt.toISOString(),
  };
}

/** Queue one delivery per subscribed endpoint. The payload is snapshotted now. */
export async function queueWebhooks(
  event: WebhookEvent,
  booking: Booking,
  meetingType: MeetingType
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({ where: { active: true } });
  const targets: { endpointId: string | null; url: string }[] = endpoints
    .filter((e) => !e.events.length || e.events.includes(event))
    .map((e) => ({ endpointId: e.id, url: e.url }));

  const legacyUrl = await getSetting("WEBHOOK_URL");
  if (legacyUrl && !targets.some((t) => t.url === legacyUrl)) targets.push({ endpointId: null, url: legacyUrl });
  if (!targets.length) return;

  const body = { event, createdAt: new Date().toISOString(), data: bookingPayload(booking, meetingType) };
  for (const t of targets) {
    await enqueue(
      "webhook",
      { endpointId: t.endpointId, url: t.url, body },
      {
        bookingId: booking.id,
        // One delivery per endpoint per event per booking state.
        dedupeKey: `webhook:${t.endpointId ?? "legacy"}:${event}:${booking.id}:${booking.startTime.getTime()}:${booking.status}`,
      }
    );
  }
}

/** Job handler body: POST it, throw on non-2xx so the outbox retries. */
export async function deliverWebhook(payload: {
  endpointId: string | null;
  url: string;
  body: unknown;
}): Promise<void> {
  let secret: string | undefined;
  if (payload.endpointId) {
    const ep = await prisma.webhookEndpoint.findUnique({ where: { id: payload.endpointId } });
    if (!ep || !ep.active) return; // endpoint removed since — nothing to do
    secret = ep.secret;
  } else {
    secret = await getSetting("WEBHOOK_SECRET");
  }

  try {
    await assertPublicUrl(payload.url);
  } catch (err) {
    if (err instanceof BlockedUrlError) throw new PermanentJobError(`blocked webhook URL ${payload.url}: ${err.message}`, { alert: true });
    throw err;
  }
  const raw = JSON.stringify(payload.body);
  const res = await fetch(payload.url, {
    redirect: "manual",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "BookKit-Webhooks/2",
      ...(secret ? { "BookKit-Signature": sign(secret, raw) } : {}),
    },
    body: raw,
    signal: AbortSignal.timeout(10_000),
  });

  if (payload.endpointId) {
    await prisma.webhookEndpoint
      .update({
        where: { id: payload.endpointId },
        data: { lastStatus: res.status, ...(res.ok ? { lastDeliveredAt: new Date() } : {}) },
      })
      .catch(() => undefined);
  }
  if (!res.ok) throw new Error(`webhook ${payload.url} returned ${res.status}`);
}
