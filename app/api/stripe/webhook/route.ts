import type Stripe from "stripe";
import { sendWebhookSignatureAlert } from "@/lib/alerts";
import { expireBookingBySession, finalizePaidBooking, finalizePaidIntent } from "@/lib/booking";
import { fail, ok } from "@/lib/http";
import { env } from "@/lib/env";
import { errorMessage, log } from "@/lib/logger";
import { stripe, stripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/stripe/webhook
 *
 * Signature-verified and idempotent. Note this endpoint may share a Stripe account with
 * other apps, so unknown sessions are acknowledged and ignored rather than treated as errors.
 */
export async function POST(req: Request) {
  if (!stripeConfigured()) return fail("Stripe is not configured.", 503, "STRIPE_NOT_CONFIGURED");

  const secret = env("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    log.error("stripe-webhook", "missing_secret");
    return fail("Webhook secret is not configured.", 503, "NO_WEBHOOK_SECRET");
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return fail("Missing signature.", 400, "NO_SIGNATURE");

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    const reason = errorMessage(err);
    log.error("stripe-webhook", "signature_failed", { error: reason });
    await sendWebhookSignatureAlert(reason).catch(() => undefined);
    return fail("Invalid signature.", 400, "BAD_SIGNATURE");
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
        await finalizePaidBooking({
          id: session.id,
          payment_intent:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id ?? null,
          payment_status: session.payment_status ?? null,
          amount_total: session.amount_total ?? null,
        });
      } else {
        log.info("stripe-webhook", "completed_but_unpaid", {
          sessionId: session.id,
          paymentStatus: session.payment_status,
        });
      }
    } else if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      await expireBookingBySession(session.id);
    } else if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object as Stripe.PaymentIntent;
      await finalizePaidIntent({
        id: intent.id,
        amount_received: intent.amount_received ?? null,
      });
    }
  } catch (err) {
    // Return 500 so Stripe retries — the handler is idempotent.
    log.error("stripe-webhook", "handler_failed", {
      type: event.type,
      error: errorMessage(err),
    });
    return fail("Handler error.", 500, "HANDLER_FAILED");
  }

  return ok({ received: true });
}
