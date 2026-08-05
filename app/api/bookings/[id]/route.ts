import { prisma } from "@/lib/db";
import { clientIp, fail, ok } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/bookings/[id] — minimal status polling for the success page. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const limited = rateLimit(`booking-status:${clientIp(req)}`, { limit: 120, windowMs: 60_000 });
  if (!limited.allowed) return fail("Too many requests.", 429, "RATE_LIMITED");

  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      startTime: true,
      endTime: true,
      timezone: true,
      name: true,
      meetLink: true,
      cancelToken: true,
      meetingType: { select: { name: true, slug: true, color: true, redirectUrl: true } },
    },
  });

  if (!booking) return fail("Booking not found.", 404, "NOT_FOUND");

  return ok({
    booking: {
      id: booking.id,
      status: booking.status,
      startTime: booking.startTime.toISOString(),
      endTime: booking.endTime.toISOString(),
      timezone: booking.timezone,
      name: booking.name,
      meetLink: booking.meetLink,
      cancelToken: booking.status === "CONFIRMED" ? booking.cancelToken : null,
      meetingType: booking.meetingType,
    },
  });
}
