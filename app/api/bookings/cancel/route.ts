import { cancelBooking } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { clientIp, fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** POST /api/bookings/cancel — { token } from the unguessable cancel link. */
export async function POST(req: Request) {
  const limited = rateLimit(`cancel:${clientIp(req)}`, { limit: 10, windowMs: 60_000 });
  if (!limited.allowed) return fail("Too many requests.", 429, "RATE_LIMITED");

  const body = await readJson<{ token?: unknown }>(req);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return fail("Missing cancellation token.", 400, "BAD_TOKEN");

  const booking = await prisma.booking.findUnique({
    where: { cancelToken: token },
    include: { meetingType: true, host: true },
  });

  if (!booking) return fail("This cancellation link is not valid.", 404, "NOT_FOUND");

  if (booking.status === "CANCELLED") {
    return ok({ alreadyCancelled: true, meetingTypeSlug: booking.meetingType.slug });
  }
  if (booking.status !== "CONFIRMED") {
    return fail("This booking is not active.", 400, "NOT_ACTIVE");
  }

  try {
    const result = await cancelBooking(booking, "booker");
    return ok({
      cancelled: true,
      calendarRemoved: result.calendarRemoved,
      meetingTypeSlug: booking.meetingType.slug,
    });
  } catch (err) {
    log.error("cancel", "failed", { bookingId: booking.id, error: errorMessage(err) });
    return fail("Could not cancel. Please reply to your confirmation email.", 500, "CANCEL_FAILED");
  }
}
