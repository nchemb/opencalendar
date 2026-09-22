import { DateTime } from "luxon";
import { getAvailability, pausedMessage } from "@/lib/availability";
import { hostBookingBlocked, resolveDuration, resolveSingleUseLink } from "@/lib/booking";
import { apiBookingErrorResponse, apiFail, apiOk, corsPreflight, requireApiKey } from "@/lib/api-auth";
import { errorMessage, log } from "@/lib/logger";
import { findActiveMeetingType } from "@/lib/meeting-types";
import { rateLimit } from "@/lib/rate-limit";
import { isValidTimezone } from "@/lib/validate";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/** GET /api/v1/event-types/{slug}/availability?from&to&tz&duration */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const auth = await requireApiKey(req);
  if ("response" in auth) return auth.response;
  if (!rateLimit(`v1:${auth.key.id}`, { limit: 300, windowMs: 60_000 }).allowed) {
    return apiFail("Too many requests.", 429, "RATE_LIMITED");
  }

  const found = await findActiveMeetingType(params.slug);
  if (!found) return apiFail("Event type not found.", 404, "NOT_FOUND");
  const { meetingType, host } = found;

  const url = new URL(req.url);
  const tz = url.searchParams.get("tz") || meetingType.schedule?.timezone || host.timezone;
  if (!isValidTimezone(tz)) return apiFail("Invalid timezone.", 400, "BAD_TZ");

  const fromDt = DateTime.fromISO(url.searchParams.get("from") ?? "", { zone: tz });
  const toDt = DateTime.fromISO(url.searchParams.get("to") ?? "", { zone: tz });
  if (!fromDt.isValid || !toDt.isValid) return apiFail("Invalid from/to date range.", 400, "BAD_RANGE");
  const rangeStart = fromDt.startOf("day").toUTC().toJSDate();
  const rangeEnd = toDt.endOf("day").toUTC().toJSDate();
  if (rangeEnd <= rangeStart || rangeEnd.getTime() - rangeStart.getTime() > 70 * 86_400_000) {
    return apiFail("Invalid date range.", 400, "BAD_RANGE");
  }

  const paused = pausedMessage(host);
  if (paused) return apiOk({ slots: [], timezone: tz, durationMinutes: meetingType.durationMinutes, paused });
  if (hostBookingBlocked(host)) return apiFail("Booking is temporarily unavailable.", 503, "CALENDAR_DISCONNECTED");

  try {
    const durationParam = url.searchParams.get("duration");
    const link = await resolveSingleUseLink(meetingType, url.searchParams.get("link"));
    const duration = resolveDuration(meetingType, durationParam ? Number(durationParam) : undefined, link);
    const slots = await getAvailability(host, meetingType, rangeStart, rangeEnd, { durationMinutes: duration });
    return apiOk({ slots: slots.map((s) => s.toISOString()), timezone: tz, durationMinutes: duration });
  } catch (err) {
    const mapped = await apiBookingErrorResponse(err);
    log.error("api-v1-availability", "failed_closed", { slug: params.slug, error: errorMessage(err) });
    return mapped ?? apiFail("Could not load availability.", 500, "UNKNOWN");
  }
}
