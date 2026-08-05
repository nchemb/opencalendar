import { DateTime } from "luxon";
import { getAvailability } from "@/lib/availability";
import { clientIp, fail, ok } from "@/lib/http";
import { GoogleApiError, GoogleAuthError } from "@/lib/google";
import { errorMessage, log } from "@/lib/logger";
import { findActiveMeetingType, hostBookingBlocked } from "@/lib/meeting-types";
import { rateLimit } from "@/lib/rate-limit";
import { isSlug, isValidTimezone } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * GET /api/availability?slug=...&from=YYYY-MM-DD&to=YYYY-MM-DD&tz=America/New_York
 * Returns open slots as UTC instants; the client groups them into days in its own zone.
 */
export async function GET(req: Request) {
  const limited = rateLimit(`availability:${clientIp(req)}`, { limit: 120, windowMs: 60_000 });
  if (!limited.allowed) return fail("Too many requests. Slow down.", 429, "RATE_LIMITED");

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const tz = url.searchParams.get("tz") || "UTC";

  if (!isSlug(slug)) return fail("Invalid meeting type.", 400, "BAD_SLUG");
  if (!isValidTimezone(tz)) return fail("Invalid timezone.", 400, "BAD_TZ");

  const zone = tz;
  const fromDt = DateTime.fromISO(from ?? "", { zone });
  const toDt = DateTime.fromISO(to ?? "", { zone });
  if (!fromDt.isValid || !toDt.isValid) {
    return fail("Invalid date range.", 400, "BAD_RANGE");
  }

  const rangeStart = fromDt.startOf("day").toUTC().toJSDate();
  const rangeEnd = toDt.endOf("day").toUTC().toJSDate();
  if (rangeEnd <= rangeStart) return fail("Invalid date range.", 400, "BAD_RANGE");
  // Cap the window so one request cannot fan out into a huge freebusy query.
  if (rangeEnd.getTime() - rangeStart.getTime() > 70 * 86_400_000) {
    return fail("Date range too large.", 400, "RANGE_TOO_LARGE");
  }

  const found = await findActiveMeetingType(slug);
  if (!found) return fail("Meeting type not found.", 404, "NOT_FOUND");

  const { meetingType, host } = found;

  if (hostBookingBlocked(host)) {
    return fail(
      "Booking is temporarily unavailable. Please email to arrange a time.",
      503,
      "CALENDAR_DISCONNECTED"
    );
  }

  try {
    const slots = await getAvailability(host, meetingType, rangeStart, rangeEnd);
    return ok({
      slots: slots.map((s) => s.toISOString()),
      timezone: zone,
      durationMinutes: meetingType.durationMinutes,
    });
  } catch (err) {
    // Fail closed: showing no slots beats risking a double booking.
    log.error("availability", "failed_closed", { slug, error: errorMessage(err) });
    if (err instanceof GoogleAuthError) {
      return fail(
        "Booking is temporarily unavailable. Please email to arrange a time.",
        503,
        "CALENDAR_DISCONNECTED"
      );
    }
    if (err instanceof GoogleApiError) {
      return fail(
        "Could not read the calendar just now. Please try again in a moment.",
        503,
        "CALENDAR_UNREACHABLE"
      );
    }
    return fail("Could not load availability.", 500, "UNKNOWN");
  }
}
