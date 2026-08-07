/**
 * README claims covered here:
 *  - "Payment taken, no calendar event → Event creation retries 3× with backoff;
 *     if it still fails the booking becomes FAILED_NEEDS_INTERVENTION, you get an
 *     alert email, and the dashboard offers a retry. A booking is never CONFIRMED
 *     without an event id."
 *  - "Google API down while rendering availability → Fails closed — no slots shown."
 *  - "Google token revoked → Booking pages switch to an 'email me' fallback."
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const sendMail = vi.hoisted(() =>
  vi.fn(async (_args: { to: string | string[]; subject: string }) => true)
);

vi.mock("../../lib/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/mailer")>();
  return { ...actual, sendMail };
});

import { prisma } from "../../lib/db";
import {
  BookingUnavailableError,
  createFreeBooking,
  finalizePaidBooking,
  retryFailedBooking,
  startPaidCheckout,
} from "../../lib/booking";
import { getAvailability, isSlotOpen } from "../../lib/availability";
import { GoogleApiError, GoogleAuthError } from "../../lib/calendar-types";
import { memoryCalendarControl } from "../../lib/calendar-memory";
import {
  bookingInput,
  createHost,
  createMeetingType,
  createPaidMeetingType,
  slotAt,
} from "../helpers/factories";

const stripeMock = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn() } },
  paymentIntents: { create: vi.fn() },
  refunds: { create: vi.fn() },
}));

vi.mock("../../lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/stripe")>();
  return { ...actual, stripe: () => stripeMock };
});

/** Subjects of every email the code tried to send during a test. */
function sentSubjects(): string[] {
  return sendMail.mock.calls.map(([args]) => args.subject);
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMail.mockImplementation(async () => true);
  stripeMock.checkout.sessions.create.mockResolvedValue({
    id: "cs_test_calendar",
    url: "https://checkout.stripe.test/cs_test_calendar",
  });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_1", status: "succeeded" });
});

describe("the calendar write fails", () => {
  test("a free booking that exhausts its retries is flagged, not confirmed", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);

    memoryCalendarControl.failCreateAttempts(3);

    await expect(
      createFreeBooking(host, meetingType, bookingInput())
    ).rejects.toBeInstanceOf(GoogleApiError);

    const booking = await prisma.booking.findFirstOrThrow();
    expect(booking.status).toBe("FAILED_NEEDS_INTERVENTION");
    expect(booking.googleEventId).toBeNull();
    expect(booking.googleSyncError).toContain("injected fault");
    expect(booking.retryCount).toBe(1);
    expect(booking.expiresAt).toBeNull();

    expect(sentSubjects().some((s) => s.includes("[CRITICAL]"))).toBe(true);
  });

  test("a transient failure inside the retry budget still confirms", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);

    // Two failures, third attempt succeeds.
    memoryCalendarControl.failCreateAttempts(2);

    const booking = await createFreeBooking(host, meetingType, bookingInput());
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.googleEventId).toBeTruthy();
    expect(memoryCalendarControl.eventCount()).toBe(1);
  });

  test("a booking is never CONFIRMED without an event id", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);

    memoryCalendarControl.failCreateAttempts(3);
    await expect(createFreeBooking(host, meetingType, bookingInput())).rejects.toThrow();

    const confirmedWithoutEvent = await prisma.booking.count({
      where: { status: "CONFIRMED", googleEventId: null },
    });
    expect(confirmedWithoutEvent).toBe(0);
  });

  test("a paid booking that fails the calendar write says so in the alert", async () => {
    const host = await createHost();
    const meetingType = await createPaidMeetingType(host);
    const { booking } = await startPaidCheckout(host, meetingType, bookingInput());

    memoryCalendarControl.failCreateAttempts(3);

    await finalizePaidBooking({
      id: booking.stripeSessionId!,
      payment_intent: "pi_calendar_fail",
      payment_status: "paid",
      amount_total: 6900,
    });

    const failed = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(failed.status).toBe("FAILED_NEEDS_INTERVENTION");
    expect(failed.stripePaymentStatus).toBe("paid");

    // The money is kept, not auto-refunded — this is a calendar outage, not a
    // slot conflict. The host is told to sort it out by hand.
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(sentSubjects().some((s) => s.includes("AFTER PAYMENT"))).toBe(true);
  });

  test("the admin retry recovers a failed booking once the calendar is back", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);

    memoryCalendarControl.failCreateAttempts(3);
    await expect(createFreeBooking(host, meetingType, bookingInput())).rejects.toThrow();

    const failed = await prisma.booking.findFirstOrThrow();
    expect(failed.status).toBe("FAILED_NEEDS_INTERVENTION");

    // Calendar recovers.
    memoryCalendarControl.failCreateAttempts(0);

    const recovered = await retryFailedBooking(failed.id);
    expect(recovered.status).toBe("CONFIRMED");
    expect(recovered.googleEventId).toBeTruthy();
    expect(recovered.googleSyncError).toBeNull();
    expect(memoryCalendarControl.eventCount()).toBe(1);
  });

  test("retry refuses bookings that are not in the failed state", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);
    const booking = await createFreeBooking(host, meetingType, bookingInput());

    await expect(retryFailedBooking(booking.id)).rejects.toThrow(/Only failed bookings/);
  });
});

describe("the calendar is unreachable", () => {
  test("availability fails closed rather than showing every slot as free", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);

    memoryCalendarControl.breakFreeBusy();

    // Throwing is the point: an empty list would be indistinguishable from
    // "fully booked", but silently returning slots would risk a double booking.
    await expect(
      getAvailability(host, meetingType, new Date(), new Date(Date.now() + 86_400_000))
    ).rejects.toBeInstanceOf(GoogleApiError);
  });

  test("booking fails closed and writes no row", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);

    memoryCalendarControl.breakFreeBusy();

    await expect(
      createFreeBooking(host, meetingType, bookingInput())
    ).rejects.toBeInstanceOf(BookingUnavailableError);

    expect(await prisma.booking.count()).toBe(0);
    expect(memoryCalendarControl.eventCount()).toBe(0);
  });

  test("isSlotOpen propagates the failure instead of answering true", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);

    memoryCalendarControl.breakFreeBusy();

    await expect(isSlotOpen(host, meetingType, slotAt())).rejects.toBeInstanceOf(GoogleApiError);
  });
});

describe("the calendar authorization is revoked", () => {
  test("booking fails closed with an unavailable error, not a crash", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);

    memoryCalendarControl.breakAuth();

    await expect(
      createFreeBooking(host, meetingType, bookingInput())
    ).rejects.toBeInstanceOf(BookingUnavailableError);

    expect(await prisma.booking.count()).toBe(0);
  });

  test("availability surfaces the auth error so the page can show the fallback", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);

    memoryCalendarControl.breakAuth();

    await expect(
      getAvailability(host, meetingType, new Date(), new Date(Date.now() + 86_400_000))
    ).rejects.toBeInstanceOf(GoogleAuthError);
  });
});
