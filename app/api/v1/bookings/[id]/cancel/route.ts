import { cancelBooking } from "@/lib/booking";
import { publicBooking } from "@/lib/booking-request";
import { apiBookingErrorResponse, apiFail, apiOk, corsPreflight, requireApiKey } from "@/lib/api-auth";
import { errorMessage, log } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { cleanString } from "@/lib/validate";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/** POST /api/v1/bookings/{id}/cancel — { reason?, notify?, refund? }. Acts as the host. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireApiKey(req);
  if ("response" in auth) return auth.response;
  if (!rateLimit(`v1-cancel:${auth.key.id}`, { limit: 30, windowMs: 60_000 }).allowed) {
    return apiFail("Too many requests.", 429, "RATE_LIMITED");
  }

  const booking = await prisma.booking.findUnique({ where: { id: params.id } });
  if (!booking) return apiFail("Booking not found.", 404, "NOT_FOUND");

  let body: Record<string, unknown> = {};
  try {
    if (req.headers.get("content-length") !== "0") body = ((await req.json()) as Record<string, unknown>) ?? {};
  } catch {
    // empty body is fine — reason/notify/refund are all optional
  }

  try {
    const r = await cancelBooking(booking.id, "host", {
      reason: cleanString(body.reason, 1000),
      notify: body.notify !== false,
      refund: body.refund !== false,
    });
    return apiOk({ booking: publicBooking(r.booking), refunded: r.refunded, calendarRemoved: r.calendarRemoved });
  } catch (err) {
    const mapped = await apiBookingErrorResponse(err);
    if (mapped) return mapped;
    log.error("api-v1-cancel", "failed", { bookingId: booking.id, error: errorMessage(err) });
    return apiFail("Could not cancel the booking.", 500, "CANCEL_FAILED");
  }
}
