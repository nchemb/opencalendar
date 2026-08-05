import { isAdmin } from "@/lib/auth";
import { cancelBooking, retryFailedBooking } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** POST /api/admin/bookings/[id] — { action: "cancel" | "retry" } */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!isAdmin()) return fail("Not authorized.", 401, "UNAUTHORIZED");

  const body = await readJson<{ action?: unknown }>(req);
  const action = body?.action;

  if (action === "retry") {
    try {
      const booking = await retryFailedBooking(params.id);
      return ok({ status: booking.status, meetLink: booking.meetLink });
    } catch (err) {
      log.error("admin", "retry_failed", { id: params.id, error: errorMessage(err) });
      return fail(
        `Retry failed: ${errorMessage(err)}`,
        502,
        "RETRY_FAILED"
      );
    }
  }

  if (action === "cancel") {
    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
      include: { meetingType: true, host: true },
    });
    if (!booking) return fail("Booking not found.", 404, "NOT_FOUND");
    if (booking.status === "CANCELLED") return ok({ status: "CANCELLED" });

    try {
      const result = await cancelBooking(booking, "host");
      return ok({ status: result.booking.status, calendarRemoved: result.calendarRemoved });
    } catch (err) {
      log.error("admin", "cancel_failed", { id: params.id, error: errorMessage(err) });
      return fail("Could not cancel that booking.", 500, "CANCEL_FAILED");
    }
  }

  return fail("Unknown action.", 400, "BAD_ACTION");
}
