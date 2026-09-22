import { cancelBooking, findByManageToken, inviteePolicy, rescheduleBooking } from "@/lib/booking";
import { publicBooking } from "@/lib/booking-request";
import { bookingErrorResponse, clientIp, fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { toPublic } from "@/lib/meeting-types";
import { rateLimit } from "@/lib/rate-limit";
import { cleanString, parseInstant } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/bookings/manage?token=… — the booking plus what the invitee may do with it. */
export async function GET(req: Request) {
  if (!rateLimit(`manage:${clientIp(req)}`, { limit: 60, windowMs: 60_000 }).allowed) {
    return fail("Too many requests.", 429, "RATE_LIMITED");
  }
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const row = await findByManageToken(token);
  if (!row) return fail("This link is not valid.", 404, "NOT_FOUND");
  const { meetingType, host, ...booking } = row;
  const policy = inviteePolicy(booking, meetingType);
  return ok({
    booking: { ...publicBooking(booking), manageToken: token },
    meetingType: toPublic(meetingType, host),
    policy,
  });
}

/**
 * POST /api/bookings/manage
 *   { token, action: "cancel", reason? }
 *   { token, action: "reschedule", startTime, reason? }
 */
export async function POST(req: Request) {
  if (!rateLimit(`manage-post:${clientIp(req)}`, { limit: 10, windowMs: 60_000 }).allowed) {
    return fail("Too many requests.", 429, "RATE_LIMITED");
  }
  const body = await readJson<Record<string, unknown>>(req);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const row = await findByManageToken(token);
  if (!row) return fail("This link is not valid.", 404, "NOT_FOUND");

  const reason = cleanString(body?.reason, 1000);
  try {
    if (body?.action === "cancel") {
      if (row.status === "CANCELLED") return ok({ alreadyCancelled: true, booking: publicBooking(row) });
      const r = await cancelBooking(row.id, "invitee", { reason });
      return ok({ booking: publicBooking(r.booking), refunded: r.refunded });
    }
    if (body?.action === "reschedule") {
      const start = parseInstant(body.startTime);
      if (!start) return fail("Pick a new time.", 400, "BAD_TIME");
      const b = await rescheduleBooking(row.id, start, "invitee", { reason });
      return ok({ booking: { ...publicBooking(b), manageToken: b.cancelToken } });
    }
    return fail("Unknown action.", 400, "BAD_ACTION");
  } catch (err) {
    const mapped = await bookingErrorResponse(err);
    if (mapped) return mapped;
    log.error("manage", "failed", { bookingId: row.id, action: body?.action, error: errorMessage(err) });
    return fail("Could not update the booking. Please reply to your confirmation email.", 500, "MANAGE_FAILED");
  }
}
