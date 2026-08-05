import assert from "node:assert/strict";
import test from "node:test";
import { DateTime } from "luxon";
import { generateSlots, isSlotOnGrid } from "../lib/availability";
import type { WeeklyHours } from "../lib/types";

const CHICAGO = "America/Chicago";
const NINE_TO_FIVE: WeeklyHours = {
  "1": [{ start: "09:00", end: "17:00" }],
  "2": [{ start: "09:00", end: "17:00" }],
  "3": [{ start: "09:00", end: "17:00" }],
  "4": [{ start: "09:00", end: "17:00" }],
  "5": [{ start: "09:00", end: "17:00" }],
};

function base(overrides: Partial<Parameters<typeof generateSlots>[0]> = {}) {
  // A quiet Wednesday well away from any DST boundary.
  const now = DateTime.fromISO("2026-09-02T08:00:00", { zone: CHICAGO }).toJSDate();
  return {
    weeklyHours: NINE_TO_FIVE,
    hostTimezone: CHICAGO,
    durationMinutes: 30,
    bufferMinutes: 0,
    rangeStart: DateTime.fromISO("2026-09-03T00:00:00", { zone: CHICAGO }).toJSDate(),
    rangeEnd: DateTime.fromISO("2026-09-03T23:59:59", { zone: CHICAGO }).toJSDate(),
    now,
    minNoticeHours: 0,
    daysInAdvance: 30,
    dailyLimit: null,
    busy: [],
    ...overrides,
  };
}

const local = (d: Date) => DateTime.fromJSDate(d, { zone: CHICAGO }).toFormat("yyyy-MM-dd HH:mm");

test("generates a full day of slots at duration granularity", () => {
  const slots = generateSlots(base());
  assert.equal(slots.length, 16); // 09:00–17:00 in 30-minute steps
  assert.equal(local(slots[0]), "2026-09-03 09:00");
  assert.equal(local(slots[slots.length - 1]), "2026-09-03 16:30");
});

test("weekend days produce nothing", () => {
  const slots = generateSlots(
    base({
      rangeStart: DateTime.fromISO("2026-09-05T00:00:00", { zone: CHICAGO }).toJSDate(),
      rangeEnd: DateTime.fromISO("2026-09-06T23:59:59", { zone: CHICAGO }).toJSDate(),
    })
  );
  assert.equal(slots.length, 0);
});

test("busy intervals remove exactly the overlapping slots", () => {
  const busyStart = DateTime.fromISO("2026-09-03T10:00:00", { zone: CHICAGO }).toJSDate();
  const busyEnd = DateTime.fromISO("2026-09-03T11:00:00", { zone: CHICAGO }).toJSDate();
  const slots = generateSlots(base({ busy: [{ start: busyStart, end: busyEnd }] }));
  const times = slots.map(local);
  assert.ok(!times.includes("2026-09-03 10:00"));
  assert.ok(!times.includes("2026-09-03 10:30"));
  assert.ok(times.includes("2026-09-03 09:30"));
  assert.ok(times.includes("2026-09-03 11:00"));
});

test("buffer pushes the next slot past a busy block", () => {
  const busyStart = DateTime.fromISO("2026-09-03T10:00:00", { zone: CHICAGO }).toJSDate();
  const busyEnd = DateTime.fromISO("2026-09-03T10:30:00", { zone: CHICAGO }).toJSDate();
  const slots = generateSlots(
    base({ bufferMinutes: 15, busy: [{ start: busyStart, end: busyEnd }] })
  );
  const times = slots.map(local);
  assert.ok(!times.includes("2026-09-03 09:30"), "slot ending at 10:00 is inside the buffer");
  assert.ok(!times.includes("2026-09-03 10:30"), "slot starting at 10:30 is inside the buffer");
  assert.ok(times.includes("2026-09-03 11:00"));
});

test("min notice hides slots that are too soon", () => {
  const slots = generateSlots(
    base({
      now: DateTime.fromISO("2026-09-03T08:00:00", { zone: CHICAGO }).toJSDate(),
      minNoticeHours: 4,
    })
  );
  assert.equal(local(slots[0]), "2026-09-03 12:00");
});

test("days in advance caps the far end", () => {
  const slots = generateSlots(
    base({
      rangeStart: DateTime.fromISO("2026-09-02T00:00:00", { zone: CHICAGO }).toJSDate(),
      rangeEnd: DateTime.fromISO("2026-12-31T23:59:59", { zone: CHICAGO }).toJSDate(),
      daysInAdvance: 2,
    })
  );
  const last = DateTime.fromJSDate(slots[slots.length - 1], { zone: CHICAGO });
  assert.ok(last <= DateTime.fromISO("2026-09-04T08:00:00", { zone: CHICAGO }));
});

test("daily limit closes the whole day once reached", () => {
  const counts = new Map([["2026-09-03", 2]]);
  const open = generateSlots(base({ dailyLimit: 3, dayCounts: counts }));
  const closed = generateSlots(base({ dailyLimit: 2, dayCounts: counts }));
  assert.ok(open.length > 0);
  assert.equal(closed.length, 0);
});

/* ---------------- DST ---------------- */

test("spring forward: 9am local stays 9am local, UTC offset shifts", () => {
  // US DST 2026 begins Sunday 8 March. Friday 6 Mar is CST (UTC-6), Monday 9 Mar is CDT (UTC-5).
  const before = generateSlots(
    base({
      now: DateTime.fromISO("2026-03-01T00:00:00", { zone: CHICAGO }).toJSDate(),
      rangeStart: DateTime.fromISO("2026-03-06T00:00:00", { zone: CHICAGO }).toJSDate(),
      rangeEnd: DateTime.fromISO("2026-03-06T23:59:59", { zone: CHICAGO }).toJSDate(),
    })
  );
  const after = generateSlots(
    base({
      now: DateTime.fromISO("2026-03-01T00:00:00", { zone: CHICAGO }).toJSDate(),
      rangeStart: DateTime.fromISO("2026-03-09T00:00:00", { zone: CHICAGO }).toJSDate(),
      rangeEnd: DateTime.fromISO("2026-03-09T23:59:59", { zone: CHICAGO }).toJSDate(),
    })
  );

  assert.equal(local(before[0]), "2026-03-06 09:00");
  assert.equal(local(after[0]), "2026-03-09 09:00");
  assert.equal(before[0].toISOString(), "2026-03-06T15:00:00.000Z"); // UTC-6
  assert.equal(after[0].toISOString(), "2026-03-09T14:00:00.000Z"); // UTC-5
  assert.equal(before.length, after.length);
});

test("fall back: the extra hour does not duplicate or drop slots", () => {
  // US DST 2026 ends Sunday 1 November. Monday 2 Nov is back on CST.
  const slots = generateSlots(
    base({
      now: DateTime.fromISO("2026-10-25T00:00:00", { zone: CHICAGO }).toJSDate(),
      rangeStart: DateTime.fromISO("2026-11-02T00:00:00", { zone: CHICAGO }).toJSDate(),
      rangeEnd: DateTime.fromISO("2026-11-02T23:59:59", { zone: CHICAGO }).toJSDate(),
    })
  );
  assert.equal(slots.length, 16);
  assert.equal(slots[0].toISOString(), "2026-11-02T15:00:00.000Z"); // UTC-6 again
  assert.equal(new Set(slots.map((s) => s.toISOString())).size, slots.length);
});

test("a booker in Tokyo sees the same instants rendered on their own date", () => {
  const slots = generateSlots(base());
  const tokyo = DateTime.fromJSDate(slots[slots.length - 1], { zone: "Asia/Tokyo" });
  // 16:30 Chicago on 3 Sep is 06:30 the next morning in Tokyo.
  assert.equal(tokyo.toFormat("yyyy-MM-dd HH:mm"), "2026-09-04 06:30");
});

/* ---------------- grid validation ---------------- */

const meetingType = {
  weeklyHours: NINE_TO_FIVE,
  durationMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 12,
  daysInAdvance: 30,
};

test("isSlotOnGrid accepts a published slot and rejects an off-grid one", () => {
  const now = DateTime.fromISO("2026-09-01T09:00:00", { zone: CHICAGO }).toJSDate();
  const good = DateTime.fromISO("2026-09-03T10:00:00", { zone: CHICAGO }).toJSDate();
  const offGrid = DateTime.fromISO("2026-09-03T10:07:00", { zone: CHICAGO }).toJSDate();
  const afterHours = DateTime.fromISO("2026-09-03T22:00:00", { zone: CHICAGO }).toJSDate();
  const weekend = DateTime.fromISO("2026-09-05T10:00:00", { zone: CHICAGO }).toJSDate();

  assert.equal(isSlotOnGrid(meetingType as never, CHICAGO, good, now), true);
  assert.equal(isSlotOnGrid(meetingType as never, CHICAGO, offGrid, now), false);
  assert.equal(isSlotOnGrid(meetingType as never, CHICAGO, afterHours, now), false);
  assert.equal(isSlotOnGrid(meetingType as never, CHICAGO, weekend, now), false);
});

test("isSlotOnGrid enforces min notice and days in advance", () => {
  const now = DateTime.fromISO("2026-09-03T09:00:00", { zone: CHICAGO }).toJSDate();
  const tooSoon = DateTime.fromISO("2026-09-03T14:00:00", { zone: CHICAGO }).toJSDate();
  const tooFar = DateTime.fromISO("2026-11-03T10:00:00", { zone: CHICAGO }).toJSDate();

  assert.equal(isSlotOnGrid(meetingType as never, CHICAGO, tooSoon, now), false);
  assert.equal(isSlotOnGrid(meetingType as never, CHICAGO, tooFar, now), false);
});
