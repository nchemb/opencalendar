/**
 * README claim: "Two people book one slot → Booking runs inside a Serializable
 * transaction that first takes a pg_advisory_xact_lock on the host, re-checks DB
 * overlaps *and* live calendar freebusy, then inserts. The loser gets a clean 409."
 *
 * These are the tests that make that sentence checkable. They run real
 * concurrent transactions against real Postgres — a mocked database cannot
 * exercise an advisory lock.
 */
import { describe, expect, test } from "vitest";
import { prisma } from "../../lib/db";
import { SlotTakenError, createFreeBooking } from "../../lib/booking";
import { memoryCalendarControl } from "../../lib/calendar-memory";
import {
  bookingInput,
  createHost,
  createMeetingType,
  slotAt,
} from "../helpers/factories";

/** Settle all promises and split them into fulfilled values and rejection reasons. */
async function settle<T>(promises: Promise<T>[]) {
  const results = await Promise.allSettled(promises);
  return {
    fulfilled: results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
    rejected: results.flatMap((r) => (r.status === "rejected" ? [r.reason] : [])),
  };
}

describe("concurrent booking of the same slot", () => {
  test("exactly one of five simultaneous bookers wins", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);
    const startTime = slotAt();

    const { fulfilled, rejected } = await settle(
      Array.from({ length: 5 }, (_, i) =>
        createFreeBooking(
          host,
          meetingType,
          bookingInput({ startTime, email: `booker${i}@example.test` })
        )
      )
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const err of rejected) expect(err).toBeInstanceOf(SlotTakenError);

    expect(fulfilled[0].status).toBe("CONFIRMED");

    // One winner in the database, and exactly one calendar event.
    const live = await prisma.booking.findMany({ where: { status: "CONFIRMED" } });
    expect(live).toHaveLength(1);
    expect(memoryCalendarControl.eventCount()).toBe(1);
  });

  test("the losers get SlotTakenError, not a database error", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);
    const startTime = slotAt();

    const { rejected } = await settle(
      Array.from({ length: 3 }, () =>
        createFreeBooking(host, meetingType, bookingInput({ startTime }))
      )
    );

    for (const err of rejected) {
      expect(err).toBeInstanceOf(SlotTakenError);
      // The API layer turns this code into a 409.
      expect((err as SlotTakenError).code).toBe("SLOT_TAKEN");
    }
  });

  test("different slots booked at the same moment all succeed", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);

    const { fulfilled, rejected } = await settle(
      [10, 11, 13, 14].map((hour) =>
        createFreeBooking(host, meetingType, bookingInput({ startTime: slotAt(hour) }))
      )
    );

    expect(rejected).toHaveLength(0);
    expect(fulfilled).toHaveLength(4);
    expect(memoryCalendarControl.eventCount()).toBe(4);
  });

  test("a second booking of the same slot is refused after the first settles", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);
    const startTime = slotAt();

    await createFreeBooking(host, meetingType, bookingInput({ startTime }));

    await expect(
      createFreeBooking(host, meetingType, bookingInput({ startTime }))
    ).rejects.toBeInstanceOf(SlotTakenError);

    expect(await prisma.booking.count({ where: { status: "CONFIRMED" } })).toBe(1);
  });
});

describe("the live calendar is re-checked inside the lock", () => {
  test("an event added to the calendar after page render blocks the booking", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);
    const startTime = slotAt();

    // The host blocks the time by hand between the booker loading the page and
    // submitting. Nothing in our database knows about it.
    memoryCalendarControl.setExternalBusy([
      { start: startTime, end: new Date(startTime.getTime() + 30 * 60_000) },
    ]);

    await expect(
      createFreeBooking(host, meetingType, bookingInput({ startTime }))
    ).rejects.toBeInstanceOf(SlotTakenError);

    expect(await prisma.booking.count()).toBe(0);
  });

  test("a calendar event just outside the slot does not block it", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);
    const startTime = slotAt();

    // Ends exactly when the slot starts.
    memoryCalendarControl.setExternalBusy([
      { start: new Date(startTime.getTime() - 60 * 60_000), end: startTime },
    ]);

    const booking = await createFreeBooking(host, meetingType, bookingInput({ startTime }));
    expect(booking.status).toBe("CONFIRMED");
  });
});

describe("buffers reserve the space around a booking", () => {
  test("a neighbouring slot inside the buffer is refused", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host, { bufferBeforeMinutes: 15, bufferAfterMinutes: 15 });
    const startTime = slotAt(10);

    await createFreeBooking(host, meetingType, bookingInput({ startTime }));

    // 10:30 starts within the 15-minute buffer trailing the 10:00–10:30 booking.
    await expect(
      createFreeBooking(
        host,
        meetingType,
        bookingInput({ startTime: new Date(startTime.getTime() + 30 * 60_000) })
      )
    ).rejects.toBeInstanceOf(SlotTakenError);
  });
});

describe("the daily limit holds under concurrency", () => {
  test("simultaneous bookers cannot exceed dailyLimit", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host, { dailyLimit: 2 });

    const { fulfilled, rejected } = await settle(
      [10, 11, 13, 14, 15].map((hour) =>
        createFreeBooking(host, meetingType, bookingInput({ startTime: slotAt(hour) }))
      )
    );

    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(3);
    for (const err of rejected) expect(err).toBeInstanceOf(SlotTakenError);
  });
});
