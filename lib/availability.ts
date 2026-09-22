import { DateTime } from "luxon";
import type { Brand, Host, MeetingType, Schedule } from "@prisma/client";
import { prisma } from "./db";
import { calendar } from "./calendar";
import type { BusyInterval } from "./calendar-types";
import { parseOverrides, parseWeeklyHours } from "./types";
import {
  explainSlots,
  generateSlots,
  isOnGrid,
  subtractInterval,
  weekKey,
  windowBounds,
  type ExplainedSlot,
  type SlotRules,
  type WindowSpec,
} from "./slots";

export type MeetingTypeFull = MeetingType & { schedule: Schedule | null; brand: Brand | null };

export const meetingTypeInclude = { schedule: true, brand: true } as const;

export function windowSpec(mt: MeetingType): WindowSpec {
  switch (mt.windowType) {
    case "BUSINESS_DAYS":
      return { type: "BUSINESS_DAYS", days: mt.daysInAdvance };
    case "DATE_RANGE":
      return mt.windowStart && mt.windowEnd
        ? { type: "DATE_RANGE", start: mt.windowStart, end: mt.windowEnd }
        : { type: "CALENDAR_DAYS", days: mt.daysInAdvance };
    case "INDEFINITE":
      return { type: "INDEFINITE" };
    default:
      return { type: "CALENDAR_DAYS", days: mt.daysInAdvance };
  }
}

/** The schedule timezone governs slot math; the host timezone is the fallback. */
export function scheduleTimezone(mt: MeetingTypeFull, host: Host): string {
  return mt.schedule?.timezone || host.timezone;
}

export function slotRules(mt: MeetingTypeFull, host: Host, durationMinutes?: number): SlotRules {
  return {
    timezone: scheduleTimezone(mt, host),
    weeklyHours: parseWeeklyHours(mt.schedule ? mt.schedule.weeklyHours : mt.weeklyHours),
    overrides: mt.schedule ? parseOverrides(mt.schedule.overrides) : [],
    durationMinutes: durationMinutes ?? mt.durationMinutes,
    incrementMinutes: mt.startIncrementMinutes,
    bufferBeforeMinutes: mt.bufferBeforeMinutes,
    bufferAfterMinutes: mt.bufferAfterMinutes,
    minNoticeMinutes: mt.minNoticeMinutes,
    window: windowSpec(mt),
    dailyLimit: mt.dailyLimit,
    weeklyLimit: mt.weeklyLimit,
  };
}

/** Null when bookable; otherwise the message to show instead of a calendar. */
export function pausedMessage(host: Host, now = new Date()): string | null {
  if (!host.paused) return null;
  if (host.pausedUntil && host.pausedUntil.getTime() <= now.getTime()) return null;
  return host.pausedMessage?.trim() || "Not taking new bookings right now. Check back soon.";
}

/**
 * What counts as a booking that owns its slot.
 *
 * A hold is live until it expires — except a paid one, which owns the slot no
 * matter how long settlement takes. Every read path and the booking transaction
 * share this definition on purpose: when they drift apart, a slot can read as
 * free and then fail to insert.
 */
export function liveBookingStatusFilter(now: Date) {
  return [
    { status: "CONFIRMED" as const },
    { status: "PENDING_PAYMENT" as const, expiresAt: { gt: now } },
    { status: "PENDING_PAYMENT" as const, stripePaymentStatus: "paid" },
  ];
}

/** Live (slot-consuming) bookings for the host inside a window. */
export async function liveBookingIntervals(
  hostId: string,
  rangeStart: Date,
  rangeEnd: Date,
  now = new Date(),
  excludeBookingId?: string
): Promise<BusyInterval[]> {
  const rows = await prisma.booking.findMany({
    where: {
      hostId,
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      startTime: { lt: rangeEnd },
      endTime: { gt: rangeStart },
      OR: liveBookingStatusFilter(now),
    },
    select: { startTime: true, endTime: true },
  });
  return rows.map((r) => ({ start: r.startTime, end: r.endTime, source: "booking" as const }));
}

/** Live bookings of one type, bucketed per schedule-local day and ISO week (for limits). */
export async function typeCounts(
  meetingTypeId: string,
  timezone: string,
  rangeStart: Date,
  rangeEnd: Date,
  now = new Date(),
  excludeBookingId?: string,
  client: Pick<typeof prisma, "booking"> = prisma
): Promise<{ dayCounts: Map<string, number>; weekCounts: Map<string, number> }> {
  // Widen to whole weeks so a weekly limit counts bookings outside the visible range.
  const from = DateTime.fromJSDate(rangeStart, { zone: timezone }).startOf("week").toJSDate();
  const to = DateTime.fromJSDate(rangeEnd, { zone: timezone }).endOf("week").toJSDate();
  const rows = await client.booking.findMany({
    where: {
      meetingTypeId,
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      startTime: { gte: from, lte: to },
      OR: liveBookingStatusFilter(now),
    },
    select: { startTime: true },
  });
  const dayCounts = new Map<string, number>();
  const weekCounts = new Map<string, number>();
  for (const r of rows) {
    const dt = DateTime.fromJSDate(r.startTime, { zone: timezone });
    const d = dt.toFormat("yyyy-MM-dd");
    const w = weekKey(dt);
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
    weekCounts.set(w, (weekCounts.get(w) ?? 0) + 1);
  }
  return { dayCounts, weekCounts };
}

/** Clamp a requested range to the bookable window so we never query Google for nothing. */
export function clampToWindow(rules: SlotRules, rangeStart: Date, rangeEnd: Date, now: Date) {
  const bounds = windowBounds(rules.window, rules.timezone, now);
  if (!bounds) return null;
  const start = Math.max(rangeStart.getTime(), now.getTime());
  const end = Math.min(rangeEnd.getTime(), bounds.last.endOf("day").toMillis());
  if (end <= start) return null;
  return { start: new Date(start), end: new Date(end) };
}

type Inputs = {
  rules: SlotRules;
  busy: BusyInterval[];
  dayCounts: Map<string, number>;
  weekCounts: Map<string, number>;
};

async function gatherInputs(
  host: Host,
  mt: MeetingTypeFull,
  durationMinutes: number | undefined,
  rangeStart: Date,
  rangeEnd: Date,
  now: Date,
  excludeBookingId?: string,
  excludeInterval?: BusyInterval
): Promise<Inputs> {
  const rules = slotRules(mt, host, durationMinutes);
  const pad = (rules.bufferBeforeMinutes + rules.bufferAfterMinutes + rules.durationMinutes) * 60_000;
  const queryStart = new Date(rangeStart.getTime() - pad);
  const queryEnd = new Date(rangeEnd.getTime() + pad);

  const [googleBusy, dbBusy, counts] = await Promise.all([
    calendar().freeBusy(host, queryStart, queryEnd),
    liveBookingIntervals(host.id, queryStart, queryEnd, now, excludeBookingId),
    typeCounts(mt.id, rules.timezone, queryStart, queryEnd, now, excludeBookingId),
  ]);

  const cal = excludeInterval ? subtractInterval(googleBusy, excludeInterval) : googleBusy;
  return { rules, busy: [...cal, ...dbBusy], ...counts };
}

/**
 * Open slots for a window. Throws if the calendar can't be read — callers MUST fail
 * closed (show no slots) rather than risk a double booking.
 */
export async function getAvailability(
  host: Host,
  mt: MeetingTypeFull,
  rangeStart: Date,
  rangeEnd: Date,
  opts: { now?: Date; durationMinutes?: number } = {}
): Promise<Date[]> {
  const now = opts.now ?? new Date();
  if (pausedMessage(host, now)) return [];
  const rules = slotRules(mt, host, opts.durationMinutes);
  const clamped = clampToWindow(rules, rangeStart, rangeEnd, now);
  if (!clamped) return [];

  const inputs = await gatherInputs(host, mt, opts.durationMinutes, clamped.start, clamped.end, now);
  return generateSlots(inputs.rules, {
    now,
    rangeStart: clamped.start,
    rangeEnd: clamped.end,
    busy: inputs.busy,
    dayCounts: inputs.dayCounts,
    weekCounts: inputs.weekCounts,
  });
}

/** Admin troubleshooter: every candidate slot on one day with the reason it is or isn't offered. */
export async function explainDay(
  host: Host,
  mt: MeetingTypeFull,
  date: string,
  opts: { now?: Date; durationMinutes?: number } = {}
): Promise<ExplainedSlot[]> {
  const now = opts.now ?? new Date();
  const rules = slotRules(mt, host, opts.durationMinutes);
  const day = DateTime.fromISO(date, { zone: rules.timezone }).startOf("day");
  if (!day.isValid) return [];
  const rangeStart = day.toJSDate();
  const rangeEnd = day.plus({ days: 1 }).toJSDate();
  const inputs = await gatherInputs(host, mt, opts.durationMinutes, rangeStart, rangeEnd, now);
  return explainSlots(inputs.rules, {
    now,
    rangeStart,
    rangeEnd,
    busy: inputs.busy,
    dayCounts: inputs.dayCounts,
    weekCounts: inputs.weekCounts,
    paused: Boolean(pausedMessage(host, now)),
  });
}

/** Pure grid check (no IO) — safe to call inside the booking transaction. */
export function isSlotOnGrid(
  mt: MeetingTypeFull,
  host: Host,
  startTime: Date,
  now = new Date(),
  durationMinutes?: number
): boolean {
  return isOnGrid(slotRules(mt, host, durationMinutes), startTime, now);
}

/**
 * Is this exact instant a legal, currently-open slot? `exclude` lets a reschedule
 * ignore the booking being moved (its own DB row and its own calendar event).
 */
export async function isSlotOpen(
  host: Host,
  mt: MeetingTypeFull,
  startTime: Date,
  opts: {
    now?: Date;
    durationMinutes?: number;
    excludeBookingId?: string;
    excludeInterval?: BusyInterval;
  } = {}
): Promise<boolean> {
  const now = opts.now ?? new Date();
  if (pausedMessage(host, now)) return false;
  const rangeStart = new Date(startTime.getTime() - 60_000);
  const rangeEnd = new Date(startTime.getTime() + 60_000);
  const inputs = await gatherInputs(
    host,
    mt,
    opts.durationMinutes,
    rangeStart,
    rangeEnd,
    now,
    opts.excludeBookingId,
    opts.excludeInterval
  );
  return generateSlots(inputs.rules, {
    now,
    rangeStart,
    rangeEnd,
    busy: inputs.busy,
    dayCounts: inputs.dayCounts,
    weekCounts: inputs.weekCounts,
  }).some((s) => s.getTime() === startTime.getTime());
}
