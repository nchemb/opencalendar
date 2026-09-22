/**
 * The slot engine. Pure: no IO, no clock — everything arrives as input, so the
 * exact same function decides what the booking page shows, what the booking
 * transaction accepts, and what the admin troubleshooter explains.
 *
 * All wall-clock math runs in the schedule's timezone through Luxon; output is UTC.
 */
import { DateTime } from "luxon";
import type { BusyInterval } from "./calendar-types";
import { toMinutes, type DateOverride, type WeeklyHours } from "./types";

export type WindowSpec =
  | { type: "CALENDAR_DAYS"; days: number }
  | { type: "BUSINESS_DAYS"; days: number }
  | { type: "DATE_RANGE"; start: string; end: string } // yyyy-MM-dd inclusive
  | { type: "INDEFINITE" };

export type SlotRules = {
  timezone: string;
  weeklyHours: WeeklyHours;
  overrides: DateOverride[];
  durationMinutes: number;
  /** Step between candidate start times. Defaults to the duration. */
  incrementMinutes?: number | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  window: WindowSpec;
  dailyLimit?: number | null;
  weeklyLimit?: number | null;
};

export type SlotContext = {
  now: Date;
  /** Generate only within [rangeStart, rangeEnd). */
  rangeStart: Date;
  rangeEnd: Date;
  /** Everything that blocks: calendar busy time and other live bookings. */
  busy: BusyInterval[];
  /** Live bookings of this type per schedule-local date (yyyy-MM-dd). */
  dayCounts?: Map<string, number>;
  /** Live bookings of this type per ISO week key (kkkk-'W'WW). */
  weekCounts?: Map<string, number>;
  /** Host paused: nothing is offered. */
  paused?: boolean;
};

export type SlotReason =
  | "ok"
  | "paused"
  | "before_min_notice"
  | "outside_window"
  | "daily_limit"
  | "weekly_limit"
  | "busy";

export type ExplainedSlot = { start: Date; reason: SlotReason; busy?: BusyInterval };

/** Guard against a pathological schedule producing an unbounded loop. */
const MAX_DAYS = 400;
const INDEFINITE_DAYS = 365;

/** Last bookable schedule-local date (inclusive), or null when the window is closed. */
export function windowBounds(
  window: WindowSpec,
  timezone: string,
  now: Date
): { first: DateTime; last: DateTime } | null {
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf("day");
  switch (window.type) {
    case "CALENDAR_DAYS":
      return { first: today, last: today.plus({ days: Math.max(0, window.days) }) };
    case "INDEFINITE":
      return { first: today, last: today.plus({ days: INDEFINITE_DAYS }) };
    case "BUSINESS_DAYS": {
      // Today is day 0; the window runs through the Nth weekday after today.
      let d = today;
      let counted = 0;
      while (counted < window.days) {
        d = d.plus({ days: 1 });
        if (d.weekday <= 5) counted++;
      }
      return { first: today, last: d };
    }
    case "DATE_RANGE": {
      const start = DateTime.fromISO(window.start, { zone: timezone }).startOf("day");
      const end = DateTime.fromISO(window.end, { zone: timezone }).startOf("day");
      if (!start.isValid || !end.isValid || end < start) return null;
      const first = start < today ? today : start;
      if (end < first) return null;
      return { first, last: end };
    }
  }
}

export function weekKey(dt: DateTime): string {
  return dt.toFormat("kkkk-'W'WW");
}

/** Hour ranges that apply on one schedule-local date (overrides win over weekly hours). */
export function rangesForDate(
  day: DateTime,
  weeklyHours: WeeklyHours,
  overrides: DateOverride[]
): { start: string; end: string }[] {
  const dateKey = day.toFormat("yyyy-MM-dd");
  const override = overrides.find((o) => o.date === dateKey);
  if (override) return override.ranges;
  const weekdayKey = String(day.weekday === 7 ? 0 : day.weekday); // Luxon 1=Mon..7=Sun
  return weeklyHours[weekdayKey] ?? [];
}

/**
 * Every candidate start on the grid inside [rangeStart, rangeEnd), each tagged
 * with why it is or isn't bookable. `generateSlots` keeps only the "ok" ones.
 */
export function explainSlots(rules: SlotRules, ctx: SlotContext): ExplainedSlot[] {
  const { timezone, durationMinutes } = rules;
  if (durationMinutes <= 0) return [];

  const increment = Math.max(5, rules.incrementMinutes || durationMinutes);
  const durationMs = durationMinutes * 60_000;
  const beforeMs = Math.max(0, rules.bufferBeforeMinutes) * 60_000;
  const afterMs = Math.max(0, rules.bufferAfterMinutes) * 60_000;
  const earliestMs = ctx.now.getTime() + Math.max(0, rules.minNoticeMinutes) * 60_000;
  const bounds = windowBounds(rules.window, timezone, ctx.now);

  const rangeStartMs = ctx.rangeStart.getTime();
  const rangeEndMs = ctx.rangeEnd.getTime();

  let day = DateTime.fromMillis(rangeStartMs, { zone: timezone }).startOf("day").minus({ days: 1 });
  const lastDay = DateTime.fromMillis(rangeEndMs, { zone: timezone }).startOf("day").plus({ days: 1 });

  const out: ExplainedSlot[] = [];
  const seen = new Set<number>();

  for (let i = 0; day <= lastDay && i < MAX_DAYS; i++, day = day.plus({ days: 1 })) {
    const dateKey = day.toFormat("yyyy-MM-dd");
    const inWindow = bounds !== null && day >= bounds.first && day <= bounds.last;
    const dayFull =
      typeof rules.dailyLimit === "number" &&
      rules.dailyLimit > 0 &&
      (ctx.dayCounts?.get(dateKey) ?? 0) >= rules.dailyLimit;
    const weekFull =
      typeof rules.weeklyLimit === "number" &&
      rules.weeklyLimit > 0 &&
      (ctx.weekCounts?.get(weekKey(day)) ?? 0) >= rules.weeklyLimit;

    for (const range of rangesForDate(day, rules.weeklyHours, rules.overrides)) {
      const [sh, sm] = range.start.split(":").map(Number);
      const endMin = toMinutes(range.end);
      if (endMin <= toMinutes(range.start)) continue;

      // set() keeps wall-clock semantics across DST; plus({minutes}) from midnight would not.
      const windowStart = day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
      const windowEnd =
        endMin >= 24 * 60
          ? day.plus({ days: 1 })
          : day.set({ hour: Math.floor(endMin / 60), minute: endMin % 60, second: 0, millisecond: 0 });

      for (
        let cursor = windowStart.toMillis(), n = 0;
        cursor + durationMs <= windowEnd.toMillis() && n < 1000;
        cursor += increment * 60_000, n++
      ) {
        if (cursor < rangeStartMs || cursor >= rangeEndMs) continue;
        if (seen.has(cursor)) continue; // DST fall-back can yield the same instant twice
        seen.add(cursor);

        const start = new Date(cursor);
        let reason: SlotReason = "ok";
        let busyHit: BusyInterval | undefined;

        if (ctx.paused) reason = "paused";
        else if (!inWindow) reason = "outside_window";
        else if (cursor < earliestMs) reason = "before_min_notice";
        else if (dayFull) reason = "daily_limit";
        else if (weekFull) reason = "weekly_limit";
        else {
          const guardStart = cursor - beforeMs;
          const guardEnd = cursor + durationMs + afterMs;
          busyHit = ctx.busy.find(
            (b) => b.start.getTime() < guardEnd && b.end.getTime() > guardStart
          );
          if (busyHit) reason = "busy";
        }
        out.push({ start, reason, ...(busyHit ? { busy: busyHit } : {}) });
      }
    }
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

export function generateSlots(rules: SlotRules, ctx: SlotContext): Date[] {
  return explainSlots(rules, ctx)
    .filter((s) => s.reason === "ok")
    .map((s) => s.start);
}

/**
 * Is `start` on the published grid and inside notice/window? Ignores busy time and
 * limits (those are checked against live data inside the booking transaction).
 */
export function isOnGrid(rules: SlotRules, start: Date, now: Date): boolean {
  const s = explainSlots(rules, {
    now,
    rangeStart: new Date(start.getTime() - 60_000),
    rangeEnd: new Date(start.getTime() + 60_000),
    busy: [],
  }).find((x) => x.start.getTime() === start.getTime());
  return s?.reason === "ok";
}

/** Remove `cut` from each busy interval (used when rescheduling: a booking never blocks itself). */
export function subtractInterval(busy: BusyInterval[], cut: BusyInterval): BusyInterval[] {
  const out: BusyInterval[] = [];
  const cs = cut.start.getTime();
  const ce = cut.end.getTime();
  for (const b of busy) {
    const bs = b.start.getTime();
    const be = b.end.getTime();
    if (be <= cs || bs >= ce) {
      out.push(b);
      continue;
    }
    if (bs < cs) out.push({ start: b.start, end: new Date(cs) });
    if (be > ce) out.push({ start: new Date(ce), end: b.end });
  }
  return out;
}
