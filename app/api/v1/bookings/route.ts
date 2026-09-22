import { createFreeBooking, priceFor, resolveDuration, resolveSingleUseLink } from "@/lib/booking";
import { parseBookingRequest, publicBooking } from "@/lib/booking-request";
import { apiBookingErrorResponse, apiFail, apiOk, corsPreflight, requireApiKey } from "@/lib/api-auth";
import { appUrl } from "@/lib/env";
import { errorMessage, log } from "@/lib/logger";
import { findActiveMeetingType } from "@/lib/meeting-types";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { isSlug } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export function OPTIONS() {
  return corsPreflight();
}

const STATUSES = ["PENDING_PAYMENT", "CONFIRMED", "EXPIRED", "CANCELLED", "FAILED_NEEDS_INTERVENTION"] as const;

/** GET /api/v1/bookings?status&from&to&email&limit&cursor — cursor-paginated, newest start first. */
export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if ("response" in auth) return auth.response;
  if (!rateLimit(`v1:${auth.key.id}`, { limit: 300, windowMs: 60_000 }).allowed) {
    return apiFail("Too many requests.", 429, "RATE_LIMITED");
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
    return apiFail(`status must be one of: ${STATUSES.join(", ")}`, 400, "BAD_STATUS");
  }
  const email = url.searchParams.get("email");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 25));
  const cursor = url.searchParams.get("cursor");

  const rows = await prisma.booking.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(email ? { email: email.toLowerCase() } : {}),
      ...(from || to
        ? { startTime: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    orderBy: { startTime: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { meetingType: { select: { slug: true, name: true } } },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return apiOk({
    bookings: page.map((b) => ({ ...publicBooking(b), meetingType: b.meetingType })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}

/**
 * POST /api/v1/bookings — { slug, name, email, timezone, startTime, answers?, guests?, location?,
 * durationMinutes?, utm? }. Free types only: a paid type returns 402 with the booking page URL,
 * since the invitee has to pay through the hosted flow.
 */
export async function POST(req: Request) {
  const auth = await requireApiKey(req);
  if ("response" in auth) return auth.response;
  if (!rateLimit(`v1-book:${auth.key.id}`, { limit: 30, windowMs: 60_000 }).allowed) {
    return apiFail("Too many requests.", 429, "RATE_LIMITED");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiFail("Invalid JSON body.", 400, "BAD_BODY");
  }
  if (!isSlug(body.slug)) return apiFail("Invalid or missing event type slug.", 400, "BAD_SLUG");

  const found = await findActiveMeetingType(body.slug);
  if (!found) return apiFail("Event type not found.", 404, "NOT_FOUND");
  const { meetingType, host } = found;

  const parsed = parseBookingRequest(body, meetingType, host);
  if (!parsed.ok) return apiFail(parsed.error, 400, parsed.code);
  const input = parsed.input;

  try {
    const link = await resolveSingleUseLink(meetingType, input.singleUseToken);
    const amount = priceFor(meetingType, resolveDuration(meetingType, input.durationMinutes, link), link);
    if (amount) {
      return apiFail(
        "This event type requires payment. Send the person to the booking page to pay.",
        402,
        "PAYMENT_REQUIRED",
        { bookingUrl: `${appUrl()}/${meetingType.slug}` }
      );
    }
    const booking = await createFreeBooking(host, meetingType, input);
    return apiOk({ booking: publicBooking(booking) }, { status: 201 });
  } catch (err) {
    const mapped = await apiBookingErrorResponse(err);
    if (mapped) return mapped;
    log.error("api-v1-bookings", "create_failed", { slug: body.slug, error: errorMessage(err) });
    return apiFail("Something went wrong creating the booking. Please try again.", 500, "BOOKING_FAILED");
  }
}
