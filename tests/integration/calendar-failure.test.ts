/**
 * README claims covered here:
 *  - "Calendar write fails → the booking is still confirmed (the slot is the
 *     invitee's), a calendar.create job retries with backoff, and the host gets a
 *     critical alert until the event lands."
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
  SlotTakenError,
  createFreeBooking,
  finalizePaidBooking,
  retryFailedBooking,
  startPaidCheckout,
} from "../../lib/booking";
import { getAvailability, isSlotOpen } from "../../lib/availability";
import { drainJobs } from "../../lib/jobs";
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
  test("a free booking whose calendar write fails is still confirmed, queued for retry and alerted", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);

    memoryCalendarControl.failCreateAttempts(3);

    const booking = await createFreeBooking(host, meetingType, bookingInput());
    // The slot is the invitee's: confirmed in our DB even though Google said no.
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.googleEventId).toBeNull();
    expect(booking.googleSyncError).toContain("injected fault");
    expect(booking.expiresAt).toBeNull();

    const job = await prisma.job.findFirstOrThrow({ where: { bookingId: booking.id, kind: "calendar.create" } });
    expect(job.doneAt).toBeNull();

    const alert = await prisma.alert.findFirstOrThrow({ where: { bookingId: booking.id, kind: "calendar_pending" } });
    expect(alert.severity).toBe("critical");
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

  test("a confirmed booking without an event still owns its slot", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);
    const startTime = slotAt();

    memoryCalendarControl.failCreateAttempts(3);
    await createFreeBooking(host, meetingType, bookingInput({ startTime }));

    await expect(
      createFreeBooking(host, meetingType, bookingInput({ startTime, email: "second@example.test" }))
    ).rejects.toBeInstanceOf(SlotTakenError);
  });

  test("the queued write lands once the calendar recovers, and the alert closes", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);

    memoryCalendarControl.failCreateAttempts(3);
    const booking = await createFreeBooking(host, meetingType, bookingInput());

    memoryCalendarControl.failCreateAttempts(0);
    await prisma.job.updateMany({ where: { bookingId: booking.id }, data: { runAt: new Date() } });
    await drainJobs({ budgetMs: 5_000 });

    const fixed = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(fixed.googleEventId).toBeTruthy();
    expect(fixed.googleSyncError).toBeNull();
    expect(memoryCalendarControl.eventCount()).toBe(1);
    const alert = await prisma.alert.findFirstOrThrow({ where: { bookingId: booking.id, kind: "calendar_pending" } });
    expect(alert.resolvedAt).not.toBeNull();
  });

  test("a paid booking that fails the calendar write keeps the money and says so in the alert", async () => {
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

    const settled = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(settled.status).toBe("CONFIRMED");
    expect(settled.stripePaymentStatus).toBe("paid");
    expect(settled.googleEventId).toBeNull();

    // A calendar outage is not a slot conflict: no refund, the host is told.
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(sentSubjects().some((s) => s.includes("(paid)"))).toBe(true);
  });

  test("the admin retry writes the event immediately once the calendar is back", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);

    memoryCalendarControl.failCreateAttempts(3);
    const pending = await createFreeBooking(host, meetingType, bookingInput());
    memoryCalendarControl.failCreateAttempts(0);

    const recovered = await retryFailedBooking(pending.id);
    expect(recovered.status).toBe("CONFIRMED");
    expect(recovered.googleEventId).toBeTruthy();
    expect(recovered.googleSyncError).toBeNull();
    expect(memoryCalendarControl.eventCount()).toBe(1);
  });

  test("retry on a healthy booking is a no-op", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);
    const booking = await createFreeBooking(host, meetingType, bookingInput());

    const again = await retryFailedBooking(booking.id);
    expect(again.googleEventId).toBe(booking.googleEventId);
    expect(memoryCalendarControl.eventCount()).toBe(1);
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
