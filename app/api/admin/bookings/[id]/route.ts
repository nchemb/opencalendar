import { randomBytes } from "node:crypto";
import { adminSession } from "@/lib/auth";
import {
  cancelBooking,
  markNoShow,
  refundBooking,
  rescheduleBooking,
  retryFailedBooking,
} from "@/lib/booking";
import { enqueue } from "@/lib/jobs";
import { prisma } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { parseInstant } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/bookings/[id]
 * { action: "cancel" | "reschedule" | "no_show" | "retry" | "refund" | "resend" }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");

  const body = await readJson<Record<string, unknown>>(req);
  const action = body?.action;

  try {
    if (action === "retry") {
      const booking = await retryFailedBooking(params.id);
      return ok({ status: booking.status, meetLink: booking.meetLink });
    }

    if (action === "cancel") {
      const booking = await prisma.booking.findUnique({ where: { id: params.id } });
      if (!booking) return fail("Booking not found.", 404, "NOT_FOUND");
      if (booking.status === "CANCELLED") return ok({ status: "CANCELLED" });
      const result = await cancelBooking(booking.id, "host", {
        reason: typeof body?.reason === "string" ? body.reason : null,
        notify: body?.notify !== false,
        refund: body?.refund === true,
      });
      return ok({ status: result.booking.status, refunded: result.refunded, calendarRemoved: result.calendarRemoved });
    }

    if (action === "reschedule") {
      const newStart = parseInstant(body?.startTime);
      if (!newStart) return fail("Invalid start time.", 400, "VALIDATION");
      const updated = await rescheduleBooking(params.id, newStart, "host", {
        reason: typeof body?.reason === "string" ? body.reason : null,
      });
      return ok({ status: updated.status, startTime: updated.startTime.toISOString() });
    }

    if (action === "no_show") {
      const booking = await markNoShow(params.id, body?.noShow !== false);
      return ok({ noShow: booking.noShow });
    }

    if (action === "refund") {
      const refunded = await refundBooking(params.id, "host_requested");
      return ok({ refunded });
    }

    if (action === "resend") {
      // A fresh dedupe key (timestamp suffix) so this doesn't collide with the
      // original confirmation email's dedupe and get silently skipped.
      await enqueue(
        "email",
        { template: "confirmation" },
        { bookingId: params.id, dedupeKey: `email:confirmation:resend:${params.id}:${randomBytes(4).toString("hex")}` }
      );
      const { drainJobs } = await import("@/lib/jobs");
      await drainJobs({ bookingId: params.id, budgetMs: 5000 });
      return ok({ resent: true });
    }

    return fail("Unknown action.", 400, "BAD_ACTION");
  } catch (err) {
    log.error("admin", "booking_action_failed", { id: params.id, action, error: errorMessage(err) });
    return fail(errorMessage(err) || "Action failed.", 502, "ACTION_FAILED");
  }
}
