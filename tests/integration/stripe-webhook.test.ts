/**
 * The Stripe webhook is the one endpoint where an unauthenticated POST moves
 * money and writes calendar events, so signature handling gets its own tests.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({
  webhooks: { constructEvent: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
  paymentIntents: { create: vi.fn() },
  refunds: { create: vi.fn() },
}));

const sendMail = vi.hoisted(() =>
  vi.fn(async (_args: { to: string | string[]; subject: string }) => true)
);

vi.mock("../../lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/stripe")>();
  return { ...actual, stripe: () => stripeMock };
});

vi.mock("../../lib/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/mailer")>();
  return { ...actual, sendMail };
});

import { POST as webhookRoute } from "../../app/api/stripe/webhook/route";
import { prisma } from "../../lib/db";
import { startPaidCheckout } from "../../lib/booking";
import { memoryCalendarControl } from "../../lib/calendar-memory";
import { bookingInput, createHost, createPaidMeetingType } from "../helpers/factories";

function webhookRequest(body: string, signature: string | null = "t=1,v1=deadbeef") {
  return new Request("http://localhost:3000/api/stripe/webhook", {
    method: "POST",
    headers: signature ? { "stripe-signature": signature } : {},
    body,
  });
}

async function json(res: Response) {
  return (await res.json()) as { ok: boolean; code?: string; received?: boolean };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMail.mockImplementation(async () => true);
  stripeMock.checkout.sessions.create.mockResolvedValue({
    id: "cs_test_webhook",
    url: "https://checkout.stripe.test/cs_test_webhook",
  });
});

describe("signature verification", () => {
  test("a request with no signature header is refused", async () => {
    const res = await webhookRoute(webhookRequest("{}", null));
    expect(res.status).toBe(400);
    expect(await json(res).then((b) => b.code)).toBe("NO_SIGNATURE");
    expect(stripeMock.webhooks.constructEvent).not.toHaveBeenCalled();
  });

  test("a bad signature is refused and alerts the host", async () => {
    stripeMock.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });

    const res = await webhookRoute(webhookRequest(JSON.stringify({ type: "anything" })));

    expect(res.status).toBe(400);
    expect(await json(res).then((b) => b.code)).toBe("BAD_SIGNATURE");
    expect(sendMail.mock.calls.some(([a]) => a.subject.includes("signature failed"))).toBe(true);
  });

  test("a forged event body cannot settle a booking", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);
    const { booking } = await startPaidCheckout(host, meetingType, bookingInput());

    stripeMock.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("signature mismatch");
    });

    await webhookRoute(
      webhookRequest(
        JSON.stringify({
          type: "checkout.session.completed",
          data: { object: { id: booking.stripeSessionId, payment_status: "paid" } },
        })
      )
    );

    const untouched = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(untouched.status).toBe("PENDING_PAYMENT");
    expect(untouched.stripePaymentStatus).toBe("unpaid");
    expect(memoryCalendarControl.eventCount()).toBe(0);
  });

  test("the raw body is what gets verified, not a re-serialised object", async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: "cs_unknown", payment_status: "paid", amount_total: 100 } },
    });

    const raw = '{"type":"checkout.session.completed","spacing":  "preserved"}';
    await webhookRoute(webhookRequest(raw));

    expect(stripeMock.webhooks.constructEvent.mock.calls[0][0]).toBe(raw);
  });
});

describe("event dispatch", () => {
  test("a verified paid session confirms the booking", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);
    const { booking } = await startPaidCheckout(host, meetingType, bookingInput());

    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: booking.stripeSessionId,
          payment_status: "paid",
          payment_intent: "pi_verified",
          amount_total: 6900,
        },
      },
    });

    const res = await webhookRoute(webhookRequest("{}"));
    expect(res.status).toBe(200);
    expect(await json(res).then((b) => b.received)).toBe(true);

    const settled = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(settled.status).toBe("CONFIRMED");
    expect(memoryCalendarControl.eventCount()).toBe(1);
  });

  test("a completed-but-unpaid session does not confirm anything", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);
    const { booking } = await startPaidCheckout(host, meetingType, bookingInput());

    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: booking.stripeSessionId, payment_status: "unpaid" } },
    });

    const res = await webhookRoute(webhookRequest("{}"));
    expect(res.status).toBe(200);

    const still = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(still.status).toBe("PENDING_PAYMENT");
    expect(memoryCalendarControl.eventCount()).toBe(0);
  });

  test("an expired session releases the hold", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);
    const { booking } = await startPaidCheckout(host, meetingType, bookingInput());

    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.expired",
      data: { object: { id: booking.stripeSessionId } },
    });

    await webhookRoute(webhookRequest("{}"));

    const released = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(released.status).toBe("EXPIRED");
  });

  test("an event type we do not handle is acknowledged and ignored", async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_123" } },
    });

    const res = await webhookRoute(webhookRequest("{}"));
    expect(res.status).toBe(200);
  });

  test("another app's session on a shared Stripe account is ignored, not errored", async () => {
    // The account behind this instance may serve several products; Stripe fires
    // every checkout event at every endpoint on the account.
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_some_other_product",
          payment_status: "paid",
          payment_intent: "pi_other",
          amount_total: 2900,
        },
      },
    });

    const res = await webhookRoute(webhookRequest("{}"));
    expect(res.status).toBe(200);
    expect(await prisma.booking.count()).toBe(0);
  });

  test("a handler failure returns 500 so Stripe retries", async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: "cs_boom", payment_status: "paid", amount_total: 100 } },
    });

    // Patch and put back by hand: vi.spyOn(...).mockRestore() on a Prisma model
    // delegate deletes the property from the shared client, breaking every later
    // test file in the same fork.
    const original = prisma.booking.findUnique;
    (prisma.booking as { findUnique: unknown }).findUnique = vi.fn().mockRejectedValueOnce(new Error("database is on fire"));
    try {
      const res = await webhookRoute(webhookRequest("{}"));
      expect(res.status).toBe(500);
      expect(await json(res).then((b) => b.code)).toBe("HANDLER_FAILED");
    } finally {
      (prisma.booking as { findUnique: unknown }).findUnique = original;
    }
  });
});
