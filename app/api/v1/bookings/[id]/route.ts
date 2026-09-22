import { prisma } from "@/lib/db";
import { publicBooking } from "@/lib/booking-request";
import { apiFail, apiOk, corsPreflight, requireApiKey } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/** GET /api/v1/bookings/{id} */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireApiKey(req);
  if ("response" in auth) return auth.response;
  if (!rateLimit(`v1:${auth.key.id}`, { limit: 300, windowMs: 60_000 }).allowed) {
    return apiFail("Too many requests.", 429, "RATE_LIMITED");
  }

  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
    include: { meetingType: { select: { slug: true, name: true } } },
  });
  if (!booking) return apiFail("Booking not found.", 404, "NOT_FOUND");
  return apiOk({ booking: { ...publicBooking(booking), meetingType: booking.meetingType } });
}
