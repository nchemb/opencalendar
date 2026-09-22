import { rescheduleBooking } from "@/lib/booking";
import { publicBooking } from "@/lib/booking-request";
import { apiBookingErrorResponse, apiFail, apiOk, corsPreflight, requireApiKey } from "@/lib/api-auth";
import { errorMessage, log } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { cleanString, parseInstant } from "@/lib/validate";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/** POST /api/v1/bookings/{id}/reschedule — { startTime, reason? }. Acts as the host. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireApiKey(req);
  if ("response" in auth) return auth.response;
  if (!rateLimit(`v1-reschedule:${auth.key.id}`, { limit: 30, windowMs: 60_000 }).allowed) {
    return apiFail("Too many requests.", 429, "RATE_LIMITED");
  }

  const booking = await prisma.booking.findUnique({ where: { id: params.id } });
  if (!booking) return apiFail("Booking not found.", 404, "NOT_FOUND");

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiFail("Invalid JSON body.", 400, "BAD_BODY");
  }
  const start = parseInstant(body.startTime);
  if (!start) return apiFail("startTime must be an ISO instant.", 400, "BAD_TIME");

  try {
    const updated = await rescheduleBooking(booking.id, start, "host", { reason: cleanString(body.reason, 1000) });
    return apiOk({ booking: publicBooking(updated) });
  } catch (err) {
    const mapped = await apiBookingErrorResponse(err);
    if (mapped) return mapped;
    log.error("api-v1-reschedule", "failed", { bookingId: booking.id, error: errorMessage(err) });
    return apiFail("Could not reschedule the booking.", 500, "RESCHEDULE_FAILED");
  }
}
