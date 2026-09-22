/**
 * README claims covered here:
 *  - "Slot lost during checkout → The DB hold (33 min) always outlives the Stripe
 *     session (31 min) … If it somehow does, BookKit auto-refunds, emails an
 *     apology, and alerts you."
 *  - "Duplicate Stripe webhooks → stripeSessionId is unique and the first delivery
 *     claims the booking with a conditional update. Two deliveries produce one
 *     booking and one event."
 *  - "Abandoned checkout blocks the slot forever → No cron needed:
 *     checkout.session.expired releases the hold, and availability queries treat
 *     any hold past expiresAt as free."
 *
 * Stripe itself is mocked: these tests are about BookKit's state machine, not
 * about Stripe's API. The live money path is covered manually before release.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn() } },
  paymentIntents: { create: vi.fn() },
  refunds: { create: vi.fn() },
}));

vi.mock("../../lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/stripe")>();
  return { ...actual, stripe: () => stripeMock };
});

import { prisma } from "../../lib/db";
import {
  SlotTakenError,
  createFreeBooking,
  expireBookingBySession,
  finalizePaidBooking,
  finalizePaidIntent,
  startPaidCheckout,
  startPaidIntent,
} from "../../lib/booking";
import { getAvailability } from "../../lib/availability";
import { memoryCalendarControl } from "../../lib/calendar-memory";
import {
  bookingInput,
  createHost,
  createMeetingType,
  createPaidMeetingType,
  slotAt,
} from "../helpers/factories";

let sessionSeq = 0;

beforeEach(() => {
  vi.clearAllMocks();
  sessionSeq = 0;

  stripeMock.checkout.sessions.create.mockImplementation(async () => ({
    id: `cs_test_${++sessionSeq}`,
    url: `https://checkout.stripe.test/cs_test_${sessionSeq}`,
  }));
  stripeMock.paymentIntents.create.mockImplementation(async () => ({
    id: `pi_test_${++sessionSeq}`,
    client_secret: `pi_test_${sessionSeq}_secret_abc`,
  }));
  stripeMock.refunds.create.mockResolvedValue({ id: "re_test_1", status: "succeeded" });
});

describe("hold and checkout", () => {
  test("starting checkout holds the slot as PENDING_PAYMENT", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);

    const { booking, checkoutUrl } = await startPaidCheckout(
      host,
      meetingType,
      bookingInput()
    );

    expect(booking.status).toBe("PENDING_PAYMENT");
    expect(booking.stripeSessionId).toBe("cs_test_1");
    expect(booking.amountCents).toBe(6900);
    expect(checkoutUrl).toContain("checkout.stripe.test");

    // No calendar event until the money lands.
    expect(memoryCalendarControl.eventCount()).toBe(0);
  });

  test("the database hold outlives the Stripe session", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);

    const { booking } = await startPaidCheckout(host, meetingType, bookingInput());

    const stripeArgs = stripeMock.checkout.sessions.create.mock.calls[0][0];
    const stripeExpiryMs = stripeArgs.expires_at * 1000;

    // This ordering is the whole reason a payment can never land on a released
    // slot. If someone shortens the DB hold below the Stripe session, this fails.
    expect(booking.expiresAt!.getTime()).toBeGreaterThan(stripeExpiryMs);
  });

  test("a held slot blocks another booker while the hold is live", async () => {
    const host = await createHost();
    const paid = await createPaidMeetingType(host);
    const startTime = slotAt();
    const free = await createMeetingType(host, { slug: "free-same-host" });

    await startPaidCheckout(host, paid, bookingInput({ startTime }));

    await expect(
      createFreeBooking(host, free, bookingInput({ startTime }))
    ).rejects.toBeInstanceOf(SlotTakenError);
  });

  test("a failure creating the Stripe session releases the hold immediately", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);

    stripeMock.checkout.sessions.create.mockRejectedValueOnce(new Error("stripe is down"));

    await expect(startPaidCheckout(host, meetingType, bookingInput())).rejects.toThrow(
      "stripe is down"
    );

    const booking = await prisma.booking.findFirstOrThrow();
    expect(booking.status).toBe("EXPIRED");
    expect(booking.expiresAt).toBeNull();
  });
});

describe("webhook settlement", () => {
  test("a paid session confirms the booking and writes one event", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);
    const { booking } = await startPaidCheckout(host, meetingType, bookingInput());

    await finalizePaidBooking({
      id: booking.stripeSessionId!,
      payment_intent: "pi_test_settle",
      payment_status: "paid",
      amount_total: 6900,
    });

    const settled = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(settled.status).toBe("CONFIRMED");
    expect(settled.stripePaymentStatus).toBe("paid");
    expect(settled.stripePaidAt).not.toBeNull();
    expect(settled.googleEventId).toBeTruthy();
    expect(settled.expiresAt).toBeNull();
    expect(memoryCalendarControl.eventCount()).toBe(1);
  });

  test("a duplicate delivery produces one booking and one event", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);
    const { booking } = await startPaidCheckout(host, meetingType, bookingInput());

    const event = {
      id: booking.stripeSessionId!,
      payment_intent: "pi_test_dup",
      payment_status: "paid",
      amount_total: 6900,
    };

    await finalizePaidBooking(event);
    await finalizePaidBooking(event);
    await finalizePaidBooking(event);

    expect(await prisma.booking.count()).toBe(1);
    expect(memoryCalendarControl.eventCount()).toBe(1);

    const settled = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(settled.status).toBe("CONFIRMED");
  });

  test("concurrent duplicate deliveries still produce one event", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);
    const { booking } = await startPaidCheckout(host, meetingType, bookingInput());

    const event = {
      id: booking.stripeSessionId!,
      payment_intent: "pi_test_race",
      payment_status: "paid",
      amount_total: 6900,
    };

    await Promise.all([
      finalizePaidBooking(event),
      finalizePaidBooking(event),
      finalizePaidBooking(event),
    ]);

    expect(memoryCalendarControl.eventCount()).toBe(1);
  });

  test("an unknown session is ignored rather than treated as an error", async () => {
    // A shared Stripe account fires every site's events at every endpoint.
    await expect(
      finalizePaidBooking({
        id: "cs_test_belongs_to_another_app",
        payment_intent: "pi_other",
        payment_status: "paid",
        amount_total: 1234,
      })
    ).resolves.toBeUndefined();

    expect(await prisma.booking.count()).toBe(0);
    expect(memoryCalendarControl.eventCount()).toBe(0);
  });

  test("an unknown payment intent is ignored", async () => {
    await expect(
      finalizePaidIntent({ id: "pi_belongs_to_another_app", amount_received: 500 })
    ).resolves.toBeUndefined();
    expect(await prisma.booking.count()).toBe(0);
  });

  test("the embedded intent flow settles the same way", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);
    const { booking } = await startPaidIntent(host, meetingType, bookingInput());

    expect(booking.status).toBe("PENDING_PAYMENT");
    expect(booking.stripePaymentIntentId).toBeTruthy();

    await finalizePaidIntent({ id: booking.stripePaymentIntentId!, amount_received: 6900 });
    await finalizePaidIntent({ id: booking.stripePaymentIntentId!, amount_received: 6900 });

    const settled = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(settled.status).toBe("CONFIRMED");
    expect(memoryCalendarControl.eventCount()).toBe(1);
  });
});

describe("abandoned checkout", () => {
  test("checkout.session.expired releases the hold", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);
    const { booking } = await startPaidCheckout(host, meetingType, bookingInput());

    await expireBookingBySession(booking.stripeSessionId!);

    const released = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(released.status).toBe("EXPIRED");
    expect(released.expiresAt).toBeNull();
  });

  test("expiring a session that already paid does not release it", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);
    const { booking } = await startPaidCheckout(host, meetingType, bookingInput());

    await finalizePaidBooking({
      id: booking.stripeSessionId!,
      payment_intent: "pi_paid_then_expire",
      payment_status: "paid",
      amount_total: 6900,
    });

    // Stripe can deliver events out of order.
    await expireBookingBySession(booking.stripeSessionId!);

    const still = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(still.status).toBe("CONFIRMED");
  });

  test("a hold past expiresAt reads as free without any cron running", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);
    const startTime = slotAt();
    const free = await createMeetingType(host, { slug: "free-same-host" });

    const { booking } = await startPaidCheckout(host, meetingType, bookingInput({ startTime }));

    // Nothing swept it — the row is still PENDING_PAYMENT, just stale.
    await prisma.booking.update({
      where: { id: booking.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const slots = await getAvailability(
      host,
      meetingType,
      new Date(startTime.getTime() - 3_600_000),
      new Date(startTime.getTime() + 3_600_000)
    );

    expect(slots.map((s) => s.getTime())).toContain(startTime.getTime());

    // And another booker can actually take it.
    const winner = await createFreeBooking(host, free, bookingInput({ startTime }));
    expect(winner.status).toBe("CONFIRMED");
  });

  test("a stale hold does not permanently burn the slot when the webhook never arrives", async () => {
    // Regression: the partial unique index Booking_live_slot_key counts every
    // PENDING_PAYMENT row as live, but availability treats an expired hold as
    // free. If checkout.session.expired never lands — endpoint down, secret
    // rotated, Stripe not configured — the slot used to advertise as open while
    // every attempt to book it failed the index with P2002.
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);
    const startTime = slotAt();
    const free = await createMeetingType(host, { slug: "free-same-host" });

    const { booking } = await startPaidCheckout(host, meetingType, bookingInput({ startTime }));

    // The abandoned hold goes stale. No webhook, no cron — nothing retires it.
    await prisma.booking.update({
      where: { id: booking.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const second = await createFreeBooking(host, free, bookingInput({ startTime }));
    expect(second.status).toBe("CONFIRMED");

    // The stale hold was retired rather than left to collide forever.
    const stale = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stale.status).toBe("EXPIRED");
  });

  test("the sweep never retires a hold that has already been paid", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);
    const startTime = slotAt();
    const free = await createMeetingType(host, { slug: "free-same-host" });

    const { booking } = await startPaidCheckout(host, meetingType, bookingInput({ startTime }));

    // Paid, but the settlement webhook has not been processed yet, and the hold
    // window lapsed while it was in flight. Retiring this would lose the money.
    await prisma.booking.update({
      where: { id: booking.id },
      data: { expiresAt: new Date(Date.now() - 60_000), stripePaymentStatus: "paid" },
    });

    await expect(
      createFreeBooking(host, free, bookingInput({ startTime, email: "other@example.test" }))
    ).rejects.toBeInstanceOf(SlotTakenError);

    const held = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(held.status).toBe("PENDING_PAYMENT");
  });
});

describe("payment lands on a slot that was taken anyway", () => {
  test("the booking fails, the card is refunded, and the row records it", async () => {
    const host = await createHost();
    const paid = await createPaidMeetingType(host);
    const free = await createMeetingType(host, { slug: "free-type" });
    const startTime = slotAt();

    const { booking } = await startPaidCheckout(host, paid, bookingInput({ startTime }));

    // Force the hold open, then let someone else take the slot — the exact
    // situation the 33-vs-31-minute margin exists to prevent.
    await prisma.booking.update({
      where: { id: booking.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await createFreeBooking(host, free, bookingInput({ startTime }));

    await finalizePaidBooking({
      id: booking.stripeSessionId!,
      payment_intent: "pi_test_conflict",
      payment_status: "paid",
      amount_total: 6900,
    });

    const failed = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(failed.status).toBe("FAILED_NEEDS_INTERVENTION");
    expect(failed.googleSyncError).toContain("Slot conflict after payment");
    expect(failed.stripePaymentStatus).toBe("refunded");

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][0]).toMatchObject({
      payment_intent: "pi_test_conflict",
      reason: "duplicate",
    });

    // The winner keeps their event; the loser never got one.
    expect(memoryCalendarControl.eventCount()).toBe(1);
    expect(failed.googleEventId).toBeNull();
  });

  test("a failed refund still leaves the booking flagged for intervention", async () => {
    const host = await createHost();
    const paid = await createPaidMeetingType(host);
    const free = await createMeetingType(host, { slug: "free-type-2" });
    const startTime = slotAt();

    const { booking } = await startPaidCheckout(host, paid, bookingInput({ startTime }));
    await prisma.booking.update({
      where: { id: booking.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await createFreeBooking(host, free, bookingInput({ startTime }));

    // Stripe keeps refusing: the refund is queued for retry, never marked done.
    stripeMock.refunds.create.mockRejectedValue(new Error("refund failed"));

    await finalizePaidBooking({
      id: booking.stripeSessionId!,
      payment_intent: "pi_test_refund_fails",
      payment_status: "paid",
      amount_total: 6900,
    });

    const failed = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(failed.status).toBe("FAILED_NEEDS_INTERVENTION");
    // Not marked refunded, because it was not.
    expect(failed.stripePaymentStatus).toBe("paid");
    // …and a refund job stays queued so it is retried rather than forgotten.
    const job = await prisma.job.findFirstOrThrow({ where: { bookingId: booking.id, kind: "refund" } });
    expect(job.doneAt).toBeNull();
  });
});

describe("demo mode", () => {
  test("refuses paid bookings so the demo can never reach a card", async () => {
    process.env.BOOKKIT_DEMO_MODE = "1";
    try {
      const host = await createHost();
      const meetingType = await createPaidMeetingType(host);

      await expect(startPaidCheckout(host, meetingType, bookingInput())).rejects.toThrow(
        /demo instance/i
      );
      await expect(startPaidIntent(host, meetingType, bookingInput())).rejects.toThrow(
        /demo instance/i
      );
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    } finally {
      delete process.env.BOOKKIT_DEMO_MODE;
    }
  });
});
