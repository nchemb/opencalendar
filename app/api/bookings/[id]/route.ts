import { prisma } from "@/lib/db";
import { syncPaymentFromStripe } from "@/lib/booking";
import { publicBooking } from "@/lib/booking-request";
import { clientIp, fail, ok } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { stripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * GET /api/bookings/[id]?t=<manage token> — status polling while a payment settles.
 * If the webhook is late, the poll asks Stripe directly so a payer is never stranded.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!rateLimit(`booking-status:${clientIp(req)}`, { limit: 120, windowMs: 60_000 }).allowed) {
    return fail("Too many requests.", 429, "RATE_LIMITED");
  }
  const token = new URL(req.url).searchParams.get("t") ?? "";
  let booking = await prisma.booking.findUnique({ where: { id: params.id }, include: { meetingType: true } });
  if (!booking || booking.cancelToken !== token) return fail("Booking not found.", 404, "NOT_FOUND");

  if (
    booking.status === "PENDING_PAYMENT" &&
    !booking.webhookProcessedAt &&
    stripeConfigured() &&
    Date.now() - booking.createdAt.getTime() > 8_000
  ) {
    await syncPaymentFromStripe(booking.id).catch((err) =>
      log.warn("booking-status", "sync_failed", { bookingId: booking!.id, error: errorMessage(err) })
    );
    booking = await prisma.booking.findUniqueOrThrow({ where: { id: params.id }, include: { meetingType: true } });
  }

  return ok({
    booking: publicBooking(booking),
    meetingType: { name: booking.meetingType.name, slug: booking.meetingType.slug, redirectUrl: booking.meetingType.redirectUrl },
  });
}
