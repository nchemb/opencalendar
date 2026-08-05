import {
  BookingUnavailableError,
  InvalidSlotError,
  SlotTakenError,
  startPaidCheckout,
} from "@/lib/booking";
import { clientIp, fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { findActiveMeetingType, hostBookingBlocked } from "@/lib/meeting-types";
import { rateLimit } from "@/lib/rate-limit";
import { stripeConfigured } from "@/lib/stripe";
import { cleanString, isEmail, isSlug, isValidTimezone, looksLikeBot, parseInstant } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** POST /api/stripe/checkout — holds the slot, then returns a hosted Checkout URL. */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const limited = rateLimit(`checkout:${ip}`, { limit: 8, windowMs: 60_000 });
  if (!limited.allowed) {
    return fail("Too many attempts. Try again shortly.", 429, "RATE_LIMITED");
  }

  if (!stripeConfigured()) {
    return fail("Payments are not configured on this instance.", 503, "STRIPE_NOT_CONFIGURED");
  }

  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail("Invalid request body.", 400, "BAD_BODY");

  if (looksLikeBot(body)) {
    log.warn("checkout", "bot_rejected", { ip });
    return fail("Could not process that request.", 400, "REJECTED");
  }

  const slug = body.slug;
  const name = cleanString(body.name, 120);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
  const timezone = body.timezone;
  const customAnswer = cleanString(body.customAnswer, 2000);
  const startTime = parseInstant(body.startTime);

  if (!isSlug(slug)) return fail("Invalid meeting type.", 400, "BAD_SLUG");
  if (!name) return fail("Please enter your name.", 400, "BAD_NAME");
  if (!isEmail(email)) return fail("Please enter a valid email address.", 400, "BAD_EMAIL");
  if (!isValidTimezone(timezone)) return fail("Invalid timezone.", 400, "BAD_TZ");
  if (!startTime) return fail("Pick a time slot.", 400, "BAD_TIME");

  const found = await findActiveMeetingType(slug);
  if (!found) return fail("Meeting type not found.", 404, "NOT_FOUND");

  const { meetingType, host } = found;

  if (!meetingType.priceCents || meetingType.priceCents <= 0) {
    return fail("This meeting type is free.", 400, "NOT_PAID");
  }
  if (hostBookingBlocked(host)) {
    return fail(
      "Booking is temporarily unavailable. Please email to arrange a time.",
      503,
      "CALENDAR_DISCONNECTED"
    );
  }

  try {
    const { booking, checkoutUrl } = await startPaidCheckout(host, meetingType, {
      name,
      email: email!,
      timezone: timezone as string,
      customAnswer,
      startTime,
    });

    return ok({ bookingId: booking.id, checkoutUrl });
  } catch (err) {
    if (err instanceof SlotTakenError) return fail(err.message, 409, err.code);
    if (err instanceof InvalidSlotError) return fail(err.message, 400, err.code);
    if (err instanceof BookingUnavailableError) return fail(err.message, 503, err.code);

    log.error("checkout", "failed", { slug, error: errorMessage(err) });
    return fail("Could not start checkout. Please try again.", 500, "CHECKOUT_FAILED");
  }
}
