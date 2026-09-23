/**
 * v2 booking behaviour: reschedule, cancellation policy + refunds, single-use
 * links, durations, guests/locations, limits, reminders and the outbox.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
  paymentIntents: { create: vi.fn(), retrieve: vi.fn() },
  refunds: { create: vi.fn() },
}));
vi.mock("../../lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/stripe")>();
  return { ...actual, stripe: () => stripeMock };
});

const sendMail = vi.hoisted(() => vi.fn(async (_a: { to: string | string[]; subject: string }) => true));
vi.mock("../../lib/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/mailer")>();
  return { ...actual, sendMail };
});

import { DateTime } from "luxon";
import { prisma } from "../../lib/db";
import {
  ChangeNotAllowedError,
  InvalidSlotError,
  SlotTakenError,
  cancelBooking,
  createFreeBooking,
  finalizePaidIntent,
  rescheduleBooking,
  startPaidIntent,
  syncPaymentFromStripe,
} from "../../lib/booking";
import { getAvailability } from "../../lib/availability";
import { drainJobs } from "../../lib/jobs";
import { memoryCalendarControl } from "../../lib/calendar-memory";
import { bookingInput, createHost, createMeetingType, createPaidMeetingType, HOST_TZ, slotAt } from "../helpers/factories";

let seq = 0;
beforeEach(() => {
  vi.clearAllMocks();
  sendMail.mockImplementation(async () => true);
  stripeMock.paymentIntents.create.mockImplementation(async () => ({ id: `pi_v2_${++seq}`, client_secret: `pi_v2_${seq}_secret` }));
  stripeMock.refunds.create.mockResolvedValue({ id: "re_v2", status: "succeeded" });
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
});

function withMail() {
  process.env.RESEND_API_KEY = "re_test_fake";
  process.env.RESEND_FROM = "BookKit <bookings@example.test>";
}

async function paidAndSettled(host: Awaited<ReturnType<typeof createHost>>, mt: Awaited<ReturnType<typeof createPaidMeetingType>>, startTime = slotAt()) {
  const { booking } = await startPaidIntent(host, mt, bookingInput({ startTime }));
  await finalizePaidIntent({ id: booking.stripePaymentIntentId!, amount_received: 6900 });
  return prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
}

describe("reschedule", () => {
  test("moves the booking, updates the same calendar event, frees the old slot", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host);
    const from = slotAt(10);
    const to = slotAt(14);
    const booking = await createFreeBooking(host, mt, bookingInput({ startTime: from }));

    const moved = await rescheduleBooking(booking.id, to, "invitee", { reason: "conflict came up" });
    expect(moved.startTime.getTime()).toBe(to.getTime());
    expect(moved.previousStartTime!.getTime()).toBe(from.getTime());
    expect(moved.rescheduleCount).toBe(1);
    expect(moved.googleEventId).toBe(booking.googleEventId);

    const [event] = memoryCalendarControl.listEvents();
    expect(event.start.getTime()).toBe(to.getTime());
    expect(memoryCalendarControl.eventCount()).toBe(1);

    const other = await createFreeBooking(host, mt, bookingInput({ startTime: from, email: "b@example.test" }));
    expect(other.status).toBe("CONFIRMED");
  });

  test("a booking never blocks its own move to an overlapping time", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host, { durationMinutes: 60, startIncrementMinutes: 30 });
    const booking = await createFreeBooking(host, mt, bookingInput({ startTime: slotAt(10) }));
    const half = new Date(slotAt(10).getTime() + 30 * 60_000);
    const moved = await rescheduleBooking(booking.id, half, "invitee");
    expect(moved.startTime.getTime()).toBe(half.getTime());
  });

  test("a separate calendar event inside the old slot still blocks the move", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host, { durationMinutes: 60, startIncrementMinutes: 30 });
    const booking = await createFreeBooking(host, mt, bookingInput({ startTime: slotAt(10) }));
    const half = new Date(slotAt(10).getTime() + 30 * 60_000);
    memoryCalendarControl.setExternalBusy([{ start: half, end: new Date(half.getTime() + 15 * 60_000) }]);
    await expect(rescheduleBooking(booking.id, half, "invitee")).rejects.toBeInstanceOf(SlotTakenError);
  });

  test("into a busy slot → SlotTakenError, booking unchanged", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host);
    const booking = await createFreeBooking(host, mt, bookingInput({ startTime: slotAt(10) }));
    await createFreeBooking(host, mt, bookingInput({ startTime: slotAt(11), email: "b@example.test" }));
    await expect(rescheduleBooking(booking.id, slotAt(11), "invitee")).rejects.toBeInstanceOf(SlotTakenError);
    const same = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(same.startTime.getTime()).toBe(slotAt(10).getTime());
  });

  test("invitees are held to the grid and the cutoff; hosts are not held to the grid", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host, { cancelCutoffHours: 24 });
    const soon = DateTime.now().setZone(HOST_TZ).plus({ hours: 5 }).startOf("hour").toJSDate();
    const b1 = await createFreeBooking(host, mt, bookingInput({ startTime: slotAt(10) }));
    await expect(rescheduleBooking(b1.id, new Date(slotAt(12).getTime() + 7 * 60_000), "invitee")).rejects.toBeInstanceOf(InvalidSlotError);
    const offGrid = new Date(slotAt(12).getTime() + 7 * 60_000);
    const hostMoved = await rescheduleBooking(b1.id, offGrid, "host");
    expect(hostMoved.startTime.getTime()).toBe(offGrid.getTime());

    // Inside the cutoff the invitee may not change it.
    await prisma.booking.update({ where: { id: b1.id }, data: { startTime: soon, endTime: new Date(soon.getTime() + 30 * 60_000) } });
    await expect(rescheduleBooking(b1.id, slotAt(15), "invitee")).rejects.toBeInstanceOf(ChangeNotAllowedError);
  });

  test("reminders follow the booking: old ones skip themselves, new ones are queued", async () => {
    withMail();
    const host = await createHost();
    const mt = await createMeetingType(host, { reminderMinutes: [60] });
    const booking = await createFreeBooking(host, mt, bookingInput({ startTime: slotAt(10, 3) }));
    await rescheduleBooking(booking.id, slotAt(15, 3), "invitee");

    const reminders = await prisma.job.findMany({ where: { bookingId: booking.id, kind: "reminder" }, orderBy: { runAt: "asc" } });
    expect(reminders).toHaveLength(2);
    // Force both due; only the one matching the current start sends.
    await prisma.job.updateMany({ where: { bookingId: booking.id, kind: "reminder" }, data: { runAt: new Date() } });
    sendMail.mockClear();
    await drainJobs({ budgetMs: 5_000 });
    const reminderMails = sendMail.mock.calls.filter(([a]) => a.subject.startsWith("Reminder"));
    expect(reminderMails).toHaveLength(1);
  });
});

describe("cancellation policy and refunds", () => {
  test("invitee cancel before the cutoff refunds a paid booking in full", async () => {
    const host = await createHost();
    const mt = await createPaidMeetingType(host, { cancelCutoffHours: 24, refundPolicy: "before_cutoff" });
    const booking = await paidAndSettled(host, mt, slotAt(10, 3));
    const r = await cancelBooking(booking.id, "invitee", { reason: "can't make it" });
    expect(r.refunded).toBe(true);
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe("CANCELLED");
    expect(row.cancelledBy).toBe("invitee");
    expect(row.cancelReason).toBe("can't make it");
    expect(row.stripePaymentStatus).toBe("refunded");
    expect(memoryCalendarControl.eventCount()).toBe(0);
  });

  test("refundPolicy never: invitee cancel keeps the money", async () => {
    const host = await createHost();
    const mt = await createPaidMeetingType(host, { refundPolicy: "never" });
    const booking = await paidAndSettled(host, mt);
    const r = await cancelBooking(booking.id, "invitee");
    expect(r.refunded).toBe(false);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  test("inside the cutoff the invitee cannot cancel; the host still can, and refunds", async () => {
    const host = await createHost();
    const mt = await createPaidMeetingType(host, { cancelCutoffHours: 48 });
    const booking = await paidAndSettled(host, mt, slotAt(10, 1));
    await expect(cancelBooking(booking.id, "invitee")).rejects.toBeInstanceOf(ChangeNotAllowedError);
    const r = await cancelBooking(booking.id, "host", { notify: true });
    expect(r.refunded).toBe(true);
  });

  test("refund is idempotent on Stripe's side (idempotency key per booking)", async () => {
    const host = await createHost();
    const mt = await createPaidMeetingType(host);
    const booking = await paidAndSettled(host, mt);
    await cancelBooking(booking.id, "host");
    const opts = stripeMock.refunds.create.mock.calls[0][1];
    expect(opts.idempotencyKey).toBe(`bookkit-refund-${booking.id}`);
  });
});

describe("payments that never got a webhook", () => {
  test("pull-based sync confirms a payment Stripe says succeeded", async () => {
    const host = await createHost();
    const mt = await createPaidMeetingType(host);
    const { booking } = await startPaidIntent(host, mt, bookingInput());
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: booking.stripePaymentIntentId, status: "succeeded", amount_received: 6900 });
    await syncPaymentFromStripe(booking.id);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe("CONFIRMED");
    expect(row.stripePaymentStatus).toBe("paid");
  });

  test("a payment still processing is left alone", async () => {
    const host = await createHost();
    const mt = await createPaidMeetingType(host);
    const { booking } = await startPaidIntent(host, mt, bookingInput());
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: booking.stripePaymentIntentId, status: "processing", amount_received: 0 });
    await syncPaymentFromStripe(booking.id);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("PENDING_PAYMENT");
  });
});

describe("single-use links, durations, guests, locations, limits", () => {
  test("a single-use link books once, overrides price, then is spent", async () => {
    const host = await createHost();
    const mt = await createPaidMeetingType(host);
    await prisma.singleUseLink.create({ data: { token: "tok_single_use_1234567890", meetingTypeId: mt.id, priceCents: 0 } });
    // Price override 0 → free booking on a paid type.
    const b = await createFreeBooking(host, mt, bookingInput({ singleUseToken: "tok_single_use_1234567890" }));
    expect(b.status).toBe("CONFIRMED");
    expect(b.amountCents).toBeNull();
    await expect(
      createFreeBooking(host, mt, bookingInput({ singleUseToken: "tok_single_use_1234567890", startTime: slotAt(14) }))
    ).rejects.toBeInstanceOf(InvalidSlotError);
  });

  test("a paid hold that expires unpaid gives the single-use link back", async () => {
    const host = await createHost();
    const mt = await createPaidMeetingType(host);
    await prisma.singleUseLink.create({ data: { token: "tok_abandoned_pay_1234567", meetingTypeId: mt.id } });
    const { booking } = await startPaidIntent(host, mt, bookingInput({ singleUseToken: "tok_abandoned_pay_1234567" }));
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "EXPIRED", expiresAt: null } });
    const again = await startPaidIntent(host, mt, bookingInput({ singleUseToken: "tok_abandoned_pay_1234567", startTime: slotAt(14) }));
    expect(again.booking.status).toBe("PENDING_PAYMENT");
  });

  test("an expired single-use link is refused", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host);
    await prisma.singleUseLink.create({ data: { token: "tok_expired_link_12345678", meetingTypeId: mt.id, expiresAt: new Date(Date.now() - 1000) } });
    await expect(createFreeBooking(host, mt, bookingInput({ singleUseToken: "tok_expired_link_12345678" }))).rejects.toThrow(/expired/);
  });

  test("an extra duration books the longer slot and blocks the whole hour", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host, { durationOptions: [{ minutes: 60 }] as never });
    const b = await createFreeBooking(host, mt, bookingInput({ startTime: slotAt(10), durationMinutes: 60 }));
    expect(b.endTime.getTime() - b.startTime.getTime()).toBe(3_600_000);
    await expect(createFreeBooking(host, mt, bookingInput({ startTime: new Date(slotAt(10).getTime() + 30 * 60_000), email: "x@example.test" }))).rejects.toBeInstanceOf(SlotTakenError);
    await expect(createFreeBooking(host, mt, bookingInput({ startTime: slotAt(14), durationMinutes: 45, email: "y@example.test" }))).rejects.toBeInstanceOf(InvalidSlotError);
  });

  test("guests and a non-Meet location reach the calendar event", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host, { locations: [{ kind: "phone_invitee" }, { kind: "google_meet" }] as never });
    const b = await createFreeBooking(host, mt, bookingInput({ guests: ["guest@example.test"], location: { kind: "phone_invitee", value: "+1 312 555 0100" } } as never));
    expect(b.guests).toEqual(["guest@example.test"]);
    expect((b.location as { kind: string }).kind).toBe("phone_invitee");
    expect(memoryCalendarControl.listEvents()[0].guestEmails).toEqual(["guest@example.test"]);
  });

  test("an unoffered location is refused", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host);
    await expect(createFreeBooking(host, mt, bookingInput({ location: { kind: "in_person", value: "my house" } } as never))).rejects.toBeInstanceOf(InvalidSlotError);
  });

  test("a weekly limit holds inside the lock", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host, { weeklyLimit: 1 });
    const monday = DateTime.now().setZone(HOST_TZ).plus({ weeks: 1 }).startOf("week");
    const tue = monday.plus({ days: 1 }).set({ hour: 10 }).toJSDate();
    const thu = monday.plus({ days: 3 }).set({ hour: 10 }).toJSDate();
    await createFreeBooking(host, mt, bookingInput({ startTime: tue }));
    await expect(createFreeBooking(host, mt, bookingInput({ startTime: thu, email: "b@example.test" }))).rejects.toBeInstanceOf(SlotTakenError);
    const slots = await getAvailability(host, mt, monday.toJSDate(), monday.plus({ days: 7 }).toJSDate());
    expect(slots).toHaveLength(0);
  });

  test("a paused host takes no bookings and offers no slots", async () => {
    const host = await createHost({ paused: true, pausedMessage: "On vacation" });
    const mt = await createMeetingType(host);
    expect(await getAvailability(host, mt, new Date(), new Date(Date.now() + 7 * 86_400_000))).toHaveLength(0);
    await expect(createFreeBooking(host, mt, bookingInput())).rejects.toThrow(/vacation/);
  });
});

describe("outbox", () => {
  test("with mail configured, confirmation + host emails go out inline and are audited", async () => {
    withMail();
    const host = await createHost();
    const mt = await createMeetingType(host);
    const b = await createFreeBooking(host, mt, bookingInput());
    const subjects = sendMail.mock.calls.map(([a]) => a.subject);
    expect(subjects.some((s) => s.startsWith("Confirmed:"))).toBe(true);
    expect(subjects.some((s) => s.startsWith("New booking:"))).toBe(true);
    const events = await prisma.bookingEvent.findMany({ where: { bookingId: b.id } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["reserved", "confirmed", "calendar_written", "email_sent"]));
  });

  test("without mail configured, email jobs complete as skipped instead of failing forever", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host);
    const b = await createFreeBooking(host, mt, bookingInput());
    const jobs = await prisma.job.findMany({ where: { bookingId: b.id, kind: "email" } });
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.doneAt && !j.deadAt)).toBe(true);
    expect(await prisma.alert.count({ where: { kind: "job_dead" } })).toBe(0);
  });

  test("a failing provider retries, then dies loudly with an alert", async () => {
    withMail();
    sendMail.mockImplementation(async () => false);
    const host = await createHost();
    const mt = await createMeetingType(host);
    const b = await createFreeBooking(host, mt, bookingInput());
    const job = await prisma.job.findFirstOrThrow({ where: { bookingId: b.id, kind: "email", payload: { path: ["template"], equals: "confirmation" } } });
    expect(job.doneAt).toBeNull();
    expect(job.lastError).toMatch(/refused or failed/);
    await prisma.job.update({ where: { id: job.id }, data: { attempts: job.maxAttempts, runAt: new Date() } });
    await drainJobs({ budgetMs: 5_000 });
    const dead = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(dead.deadAt).not.toBeNull();
    expect(await prisma.alert.count({ where: { kind: "job_dead" } })).toBe(1);
  });

  test("a job that exists twice under one dedupe key runs once", async () => {
    withMail();
    const host = await createHost();
    const mt = await createMeetingType(host);
    const b = await createFreeBooking(host, mt, bookingInput());
    const { enqueue } = await import("../../lib/jobs");
    await enqueue("email", { template: "confirmation" }, { bookingId: b.id, dedupeKey: `email:confirmation:${b.id}` });
    expect(await prisma.job.count({ where: { bookingId: b.id, dedupeKey: `email:confirmation:${b.id}` } })).toBe(1);
  });
});
