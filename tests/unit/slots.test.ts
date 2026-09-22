import assert from "node:assert/strict";
import { test } from "vitest";
import { DateTime } from "luxon";
import { explainSlots, generateSlots, isOnGrid, subtractInterval, windowBounds, type SlotContext, type SlotRules } from "../../lib/slots";
import type { WeeklyHours } from "../../lib/types";

const CHICAGO = "America/Chicago";
const NINE_TO_FIVE: WeeklyHours = Object.fromEntries(
  ["1", "2", "3", "4", "5"].map((d) => [d, [{ start: "09:00", end: "17:00" }]])
);
const EVERY_DAY: WeeklyHours = Object.fromEntries(
  ["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "09:00", end: "17:00" }]])
);

const at = (iso: string) => DateTime.fromISO(iso, { zone: CHICAGO }).toJSDate();
const local = (d: Date) => DateTime.fromJSDate(d, { zone: CHICAGO }).toFormat("yyyy-MM-dd HH:mm");

function rules(overrides: Partial<SlotRules> = {}): SlotRules {
  return {
    timezone: CHICAGO,
    weeklyHours: NINE_TO_FIVE,
    overrides: [],
    durationMinutes: 30,
    incrementMinutes: null,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minNoticeMinutes: 0,
    window: { type: "CALENDAR_DAYS", days: 30 },
    ...overrides,
  };
}

/** A quiet Wednesday well away from any DST boundary; the range is Thursday 3 Sep. */
function ctx(overrides: Partial<SlotContext> = {}): SlotContext {
  return {
    now: at("2026-09-02T08:00:00"),
    rangeStart: at("2026-09-03T00:00:00"),
    rangeEnd: at("2026-09-04T00:00:00"),
    busy: [],
    ...overrides,
  };
}

test("a full day of slots at duration granularity", () => {
  const slots = generateSlots(rules(), ctx());
  assert.equal(slots.length, 16);
  assert.equal(local(slots[0]), "2026-09-03 09:00");
  assert.equal(local(slots.at(-1)!), "2026-09-03 16:30");
});

test("the owner's schedule: 09:30–16:00, 30 min → 13 slots a day", () => {
  const hours = Object.fromEntries(["1", "2", "3", "4", "5"].map((d) => [d, [{ start: "09:30", end: "16:00" }]]));
  const slots = generateSlots(rules({ weeklyHours: hours }), ctx());
  assert.equal(slots.length, 13);
  assert.equal(local(slots[0]), "2026-09-03 09:30");
  assert.equal(local(slots.at(-1)!), "2026-09-03 15:30");
});

test("start increment is independent of duration", () => {
  const slots = generateSlots(rules({ durationMinutes: 60, incrementMinutes: 15 }), ctx());
  assert.equal(local(slots[0]), "2026-09-03 09:00");
  assert.equal(local(slots[1]), "2026-09-03 09:15");
  assert.equal(local(slots.at(-1)!), "2026-09-03 16:00"); // last one that ends by 17:00
});

test("weekend days produce nothing", () => {
  const slots = generateSlots(rules(), ctx({ rangeStart: at("2026-09-05T00:00:00"), rangeEnd: at("2026-09-07T00:00:00") }));
  assert.equal(slots.length, 0);
});

test("multiple ranges in a day, overlapping ranges are merged not doubled", async () => {
  const { parseWeeklyHours } = await import("../../lib/types");
  const hours = parseWeeklyHours({
    "4": [
      { start: "09:00", end: "10:00" },
      { start: "09:30", end: "11:00" },
      { start: "14:00", end: "15:00" },
    ],
  });
  const slots = generateSlots(rules({ weeklyHours: hours }), ctx()).map(local);
  assert.deepEqual(slots, [
    "2026-09-03 09:00",
    "2026-09-03 09:30",
    "2026-09-03 10:00",
    "2026-09-03 10:30",
    "2026-09-03 14:00",
    "2026-09-03 14:30",
  ]);
});

test("busy intervals remove exactly the overlapping slots", () => {
  const slots = generateSlots(rules(), ctx({ busy: [{ start: at("2026-09-03T10:00:00"), end: at("2026-09-03T11:00:00") }] })).map(local);
  assert.ok(!slots.includes("2026-09-03 10:00"));
  assert.ok(!slots.includes("2026-09-03 10:30"));
  assert.ok(slots.includes("2026-09-03 09:30"));
  assert.ok(slots.includes("2026-09-03 11:00"));
});

test("buffers before and after are independent", () => {
  const busy = [{ start: at("2026-09-03T12:00:00"), end: at("2026-09-03T12:30:00") }];
  // 15 min after-buffer: the 11:30 slot ends 12:00 and needs 12:15 clear → blocked.
  const after = generateSlots(rules({ bufferAfterMinutes: 15 }), ctx({ busy })).map(local);
  assert.ok(!after.includes("2026-09-03 11:30"));
  assert.ok(after.includes("2026-09-03 12:30")); // no before-buffer: may start right after
  // 15 min before-buffer: the 12:30 slot needs 12:15 clear → blocked; 11:30 fine.
  const before = generateSlots(rules({ bufferBeforeMinutes: 15 }), ctx({ busy })).map(local);
  assert.ok(before.includes("2026-09-03 11:30"));
  assert.ok(!before.includes("2026-09-03 12:30"));
});

test("min notice hides slots that are too soon", () => {
  const slots = generateSlots(rules({ minNoticeMinutes: 4 * 60 }), ctx({ now: at("2026-09-03T08:00:00") }));
  assert.equal(local(slots[0]), "2026-09-03 12:00");
});

test("calendar-day window: today plus N days", () => {
  const now = at("2026-09-02T08:00:00");
  const b = windowBounds({ type: "CALENDAR_DAYS", days: 2 }, CHICAGO, now)!;
  assert.equal(b.last.toFormat("yyyy-MM-dd"), "2026-09-04");
  const slots = generateSlots(rules({ window: { type: "CALENDAR_DAYS", days: 2 } }), ctx({ now, rangeStart: now, rangeEnd: at("2026-12-01T00:00:00") }));
  assert.equal(local(slots.at(-1)!).slice(0, 10), "2026-09-04");
});

test("business-day window matches the owner's live Calendly: Tue evening → Wed … next Thu", () => {
  // Observed 2026-09-22 (Tue, after hours): Calendly offered 09-23 through 10-01, not 10-02.
  const now = at("2026-09-22T16:49:00");
  const hours = Object.fromEntries(["1", "2", "3", "4", "5"].map((d) => [d, [{ start: "09:30", end: "16:00" }]]));
  const slots = generateSlots(
    rules({ weeklyHours: hours, window: { type: "BUSINESS_DAYS", days: 7 }, minNoticeMinutes: 0 }),
    ctx({ now, rangeStart: at("2026-09-22T00:00:00"), rangeEnd: at("2026-10-10T00:00:00") })
  );
  const days = [...new Set(slots.map((s) => local(s).slice(0, 10)))];
  assert.deepEqual(days, ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
  assert.equal(slots.length, 7 * 13);
});

test("date-range window is inclusive and never reaches into the past", () => {
  const now = at("2026-09-02T08:00:00");
  const slots = generateSlots(
    rules({ window: { type: "DATE_RANGE", start: "2026-08-01", end: "2026-09-03" } }),
    ctx({ now, rangeStart: at("2026-08-01T00:00:00"), rangeEnd: at("2026-09-30T00:00:00") })
  );
  const days = [...new Set(slots.map((s) => local(s).slice(0, 10)))];
  assert.deepEqual(days, ["2026-09-02", "2026-09-03"]);
});

test("a date override replaces the weekly hours for that date", () => {
  const off = generateSlots(rules({ overrides: [{ date: "2026-09-03", ranges: [] }] }), ctx());
  assert.equal(off.length, 0);
  const custom = generateSlots(rules({ overrides: [{ date: "2026-09-03", ranges: [{ start: "13:00", end: "14:00" }] }] }), ctx()).map(local);
  assert.deepEqual(custom, ["2026-09-03 13:00", "2026-09-03 13:30"]);
  // …and can open a normally-closed day.
  const saturday = generateSlots(
    rules({ overrides: [{ date: "2026-09-05", ranges: [{ start: "10:00", end: "11:00" }] }] }),
    ctx({ rangeStart: at("2026-09-05T00:00:00"), rangeEnd: at("2026-09-06T00:00:00") })
  );
  assert.equal(saturday.length, 2);
});

test("daily and weekly limits close the day / week", () => {
  assert.equal(generateSlots(rules({ dailyLimit: 2 }), ctx({ dayCounts: new Map([["2026-09-03", 2]]) })).length, 0);
  assert.ok(generateSlots(rules({ dailyLimit: 3 }), ctx({ dayCounts: new Map([["2026-09-03", 2]]) })).length > 0);
  assert.equal(generateSlots(rules({ weeklyLimit: 5 }), ctx({ weekCounts: new Map([["2026-W36", 5]]) })).length, 0);
});

test("paused offers nothing, and explain says why", () => {
  assert.equal(generateSlots(rules(), ctx({ paused: true })).length, 0);
  assert.ok(explainSlots(rules(), ctx({ paused: true })).every((s) => s.reason === "paused"));
});

test("explain gives a reason for every candidate, including the busy block", () => {
  const busy = [{ start: at("2026-09-03T10:00:00"), end: at("2026-09-03T10:30:00"), source: "calendar" as const, calendarId: "work" }];
  const ex = explainSlots(rules({ minNoticeMinutes: 60 * 26 }), ctx({ busy }));
  // now = 2 Sep 08:00 + 26h notice = 3 Sep 10:00; the 10:00 slot is busy, earlier ones too soon.
  assert.equal(ex.find((s) => local(s.start) === "2026-09-03 09:30")!.reason, "before_min_notice");
  const hit = ex.find((s) => local(s.start) === "2026-09-03 10:00")!;
  assert.equal(hit.reason, "busy");
  assert.equal(hit.busy?.calendarId, "work");
  assert.equal(ex.find((s) => local(s.start) === "2026-09-03 10:30")!.reason, "ok");
});

/* ---------------- DST ---------------- */

test("spring-forward day itself: 09:00 wall clock stays 09:00", () => {
  // US DST 2026 begins Sunday 8 March 02:00. Offering every day, 8 Mar must still start at 09:00 CDT.
  const slots = generateSlots(
    rules({ weeklyHours: EVERY_DAY }),
    ctx({ now: at("2026-03-01T00:00:00"), rangeStart: at("2026-03-08T00:00:00"), rangeEnd: at("2026-03-09T00:00:00") })
  );
  assert.equal(local(slots[0]), "2026-03-08 09:00");
  assert.equal(slots[0].toISOString(), "2026-03-08T14:00:00.000Z"); // UTC-5
  assert.equal(slots.length, 16);
});

test("fall-back day itself: no duplicated or dropped slots", () => {
  const slots = generateSlots(
    rules({ weeklyHours: EVERY_DAY }),
    ctx({ now: at("2026-10-25T00:00:00"), rangeStart: at("2026-11-01T00:00:00"), rangeEnd: at("2026-11-02T00:00:00") })
  );
  assert.equal(slots.length, 16);
  assert.equal(slots[0].toISOString(), "2026-11-01T15:00:00.000Z"); // back on UTC-6
  assert.equal(new Set(slots.map((s) => s.toISOString())).size, slots.length);
});

test("a range that crosses 02:00 on spring-forward day skips the missing hour", () => {
  const night = { "0": [{ start: "01:00", end: "04:00" }] };
  const slots = generateSlots(
    rules({ weeklyHours: night, durationMinutes: 60 }),
    ctx({ now: at("2026-03-01T00:00:00"), rangeStart: at("2026-03-08T00:00:00"), rangeEnd: at("2026-03-09T00:00:00") })
  );
  // 01:00 CST → 03:00 CDT is only two real hours, so two 60-minute slots fit.
  assert.equal(slots.length, 2);
});

test("a booker in Tokyo sees the same instants on their own date", () => {
  const slots = generateSlots(rules(), ctx());
  const tokyo = DateTime.fromJSDate(slots.at(-1)!, { zone: "Asia/Tokyo" });
  assert.equal(tokyo.toFormat("yyyy-MM-dd HH:mm"), "2026-09-04 06:30");
});

/* ---------------- grid + helpers ---------------- */

test("isOnGrid accepts a published slot and rejects off-grid, after-hours, weekend, too soon, too far", () => {
  const r = rules({ minNoticeMinutes: 12 * 60 });
  const now = at("2026-09-01T09:00:00");
  assert.equal(isOnGrid(r, at("2026-09-03T10:00:00"), now), true);
  assert.equal(isOnGrid(r, at("2026-09-03T10:07:00"), now), false);
  assert.equal(isOnGrid(r, at("2026-09-03T22:00:00"), now), false);
  assert.equal(isOnGrid(r, at("2026-09-05T10:00:00"), now), false);
  assert.equal(isOnGrid(r, at("2026-09-01T14:00:00"), now), false);
  assert.equal(isOnGrid(r, at("2026-11-03T10:00:00"), now), false);
});

test("subtractInterval carves a booking out of merged busy blocks", () => {
  const busy = [{ start: at("2026-09-03T09:00:00"), end: at("2026-09-03T12:00:00") }];
  const out = subtractInterval(busy, { start: at("2026-09-03T10:00:00"), end: at("2026-09-03T10:30:00") });
  assert.deepEqual(out.map((b) => [local(b.start), local(b.end)]), [
    ["2026-09-03 09:00", "2026-09-03 10:00"],
    ["2026-09-03 10:30", "2026-09-03 12:00"],
  ]);
});
