import { createFreeBooking, priceFor, resolveDuration, resolveSingleUseLink, startPaidCheckout, startPaidIntent } from "@/lib/booking";
import { parseBookingRequest, publicBooking as basePublicBooking, publicRedirectFields } from "@/lib/booking-request";
import { buildRedirectUrl } from "@/lib/ui/redirect";
import { env } from "@/lib/env";
import { bookingErrorResponse, clientIp, fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { findActiveMeetingType } from "@/lib/meeting-types";
import { rateLimit } from "@/lib/rate-limit";
import { stripeConfigured, stripeKeyMismatch } from "@/lib/stripe";
import { isSlug, looksLikeBot } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** The creator always gets the manage token — a pending paid booking needs it to poll its own status. */
const publicBooking = (b: Parameters<typeof basePublicBooking>[0]) => ({ ...basePublicBooking(b), manageToken: b.cancelToken });
export const maxDuration = 30;

/**
 * POST /api/bookings — one entry point for free and paid meeting types.
 *  free → { booking }
 *  paid → { booking, payment: { clientSecret, expiresAt } }        (embedded card form)
 *         { booking, payment: { checkoutUrl } }                     (hosted Checkout: checkout=true,
 *                                                                    or no publishable key configured)
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateLimit(`book:${ip}`, { limit: 8, windowMs: 60_000 }).allowed) {
    return fail("Too many booking attempts. Try again shortly.", 429, "RATE_LIMITED");
  }
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail("Invalid request body.", 400, "BAD_BODY");
  if (looksLikeBot(body)) {
    log.warn("bookings", "bot_rejected", { ip });
    return fail("Could not process that request.", 400, "REJECTED");
  }
  if (!isSlug(body.slug)) return fail("Invalid meeting type.", 400, "BAD_SLUG");

  const found = await findActiveMeetingType(body.slug);
  if (!found) return fail("Meeting type not found.", 404, "NOT_FOUND");
  const { meetingType, host } = found;

  const parsed = parseBookingRequest(body, meetingType, host);
  if (!parsed.ok) return fail(parsed.error, 400, parsed.code);
  const input = parsed.input;

  try {
    const link = await resolveSingleUseLink(meetingType, input.singleUseToken);
    const amount = priceFor(meetingType, resolveDuration(meetingType, input.durationMinutes, link), link);

    if (!amount) {
      const booking = await createFreeBooking(host, meetingType, input);
      const redirectUrl =
        booking.status === "CONFIRMED" && meetingType.redirectUrl
          ? buildRedirectUrl(meetingType.redirectUrl, meetingType.redirectPassParams, publicRedirectFields(booking))
          : null;
      return ok({ booking: publicBooking(booking), redirectUrl });
    }

    if (!stripeConfigured()) return fail("Payments are not configured on this instance.", 503, "STRIPE_NOT_CONFIGURED");
    if (stripeKeyMismatch()) {
      log.error("bookings", "stripe_key_mismatch", { detail: stripeKeyMismatch() });
      return fail("Payments are misconfigured on this instance.", 503, "STRIPE_KEY_MISMATCH");
    }
    const useCheckout = body.checkout === true || !env("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
    if (useCheckout) {
      const { booking, checkoutUrl } = await startPaidCheckout(host, meetingType, input);
      return ok({ booking: publicBooking(booking), payment: { checkoutUrl } });
    }
    const { booking, clientSecret, expiresAt } = await startPaidIntent(host, meetingType, input);
    return ok({ booking: publicBooking(booking), payment: { clientSecret, expiresAt } });
  } catch (err) {
    const mapped = await bookingErrorResponse(err);
    if (mapped) return mapped;
    log.error("bookings", "create_failed", { slug: body.slug, error: errorMessage(err) });
    return fail("Something went wrong creating the booking. Please try again.", 500, "BOOKING_FAILED");
  }
}
