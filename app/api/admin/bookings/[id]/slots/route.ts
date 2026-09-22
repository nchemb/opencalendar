import { DateTime } from "luxon";
import { adminSession } from "@/lib/auth";
import { getAvailability, meetingTypeInclude } from "@/lib/availability";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/bookings/[id]/slots?date=yyyy-MM-dd — reschedule helper: open
 * slots for the booking's meeting type on one host-local day.
 *
 * ponytail: does not exclude the booking's own current time from "busy" (no
 * excludeBookingId plumbing through getAvailability), so the slot the booking
 * already holds won't appear in the list even though it is legal to reselect.
 * The host can still type it into the datetime field directly. Add exclusion
 * support to getAvailability if this proves annoying in practice.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");

  const date = new URL(req.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("date=yyyy-MM-dd is required.", 400, "VALIDATION");

  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
    include: { host: true, meetingType: { include: meetingTypeInclude } },
  });
  if (!booking) return fail("Booking not found.", 404, "NOT_FOUND");

  const tz = booking.meetingType.schedule?.timezone || booking.host.timezone;
  const day = DateTime.fromISO(date, { zone: tz }).startOf("day");
  if (!day.isValid) return fail("Invalid date.", 400, "VALIDATION");

  const duration = Math.round((booking.endTime.getTime() - booking.startTime.getTime()) / 60_000);
  const slots = await getAvailability(booking.host, booking.meetingType, day.toJSDate(), day.plus({ days: 1 }).toJSDate(), {
    durationMinutes: duration,
  });
  return ok({ slots: slots.map((s) => s.toISOString()) });
}
