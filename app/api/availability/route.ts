import { DateTime } from "luxon";
import { getAvailability, pausedMessage } from "@/lib/availability";
import { hostBookingBlocked, resolveDuration, resolveSingleUseLink } from "@/lib/booking";
import { bookingErrorResponse, clientIp, fail, ok } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { findActiveMeetingType } from "@/lib/meeting-types";
import { rateLimit } from "@/lib/rate-limit";
import { isSlug, isValidTimezone } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * GET /api/availability?slug=...&from=YYYY-MM-DD&to=YYYY-MM-DD&tz=Area/City[&duration=60][&link=token]
 * Open slots as UTC instants; the client groups them into days in its own zone.
 */
export async function GET(req: Request) {
  const limited = rateLimit(`availability:${clientIp(req)}`, { limit: 120, windowMs: 60_000 });
  if (!limited.allowed) return fail("Too many requests. Slow down.", 429, "RATE_LIMITED");

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  const tz = url.searchParams.get("tz") || "UTC";
  const durationParam = url.searchParams.get("duration");
  const linkToken = url.searchParams.get("link");

  if (!isSlug(slug)) return fail("Invalid meeting type.", 400, "BAD_SLUG");
  if (!isValidTimezone(tz)) return fail("Invalid timezone.", 400, "BAD_TZ");

  const fromDt = DateTime.fromISO(url.searchParams.get("from") ?? "", { zone: tz });
  const toDt = DateTime.fromISO(url.searchParams.get("to") ?? "", { zone: tz });
  if (!fromDt.isValid || !toDt.isValid) return fail("Invalid date range.", 400, "BAD_RANGE");
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

  const paused = pausedMessage(host);
  if (paused) {
    return ok({ slots: [], timezone: tz, durationMinutes: meetingType.durationMinutes, paused });
  }
  if (hostBookingBlocked(host)) {
    return fail("Booking is temporarily unavailable. Please try again later.", 503, "CALENDAR_DISCONNECTED");
  }

  try {
    const link = await resolveSingleUseLink(meetingType, linkToken);
    const duration = resolveDuration(meetingType, durationParam ? Number(durationParam) : undefined, link);
    const slots = await getAvailability(host, meetingType, rangeStart, rangeEnd, { durationMinutes: duration });
    return ok(
      { slots: slots.map((s) => s.toISOString()), timezone: tz, durationMinutes: duration, paused: null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    // Fail closed: showing no slots beats risking a double booking.
    const mapped = await bookingErrorResponse(err);
    log.error("availability", "failed_closed", { slug, error: errorMessage(err) });
    return mapped ?? fail("Could not load availability.", 500, "UNKNOWN");
  }
}
