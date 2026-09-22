import { cancelBooking, findByManageToken } from "@/lib/booking";
import { bookingErrorResponse, clientIp, fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { cleanString } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** POST /api/bookings/cancel — { token, reason? }. v1 link shape; same as manage action=cancel. */
export async function POST(req: Request) {
  if (!rateLimit(`cancel:${clientIp(req)}`, { limit: 10, windowMs: 60_000 }).allowed) {
    return fail("Too many requests.", 429, "RATE_LIMITED");
  }
  const body = await readJson<{ token?: unknown; reason?: unknown }>(req);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const row = await findByManageToken(token);
  if (!row) return fail("This cancellation link is not valid.", 404, "NOT_FOUND");
  if (row.status === "CANCELLED") return ok({ alreadyCancelled: true, meetingTypeSlug: row.meetingType.slug });
  if (row.status !== "CONFIRMED") return fail("This booking is not active.", 400, "NOT_ACTIVE");
  try {
    const r = await cancelBooking(row.id, "invitee", { reason: cleanString(body?.reason, 1000) });
    return ok({ cancelled: true, calendarRemoved: r.calendarRemoved, refunded: r.refunded, meetingTypeSlug: row.meetingType.slug });
  } catch (err) {
    const mapped = await bookingErrorResponse(err);
    if (mapped) return mapped;
    log.error("cancel", "failed", { bookingId: row.id, error: errorMessage(err) });
    return fail("Could not cancel. Please reply to your confirmation email.", 500, "CANCEL_FAILED");
  }
}
