import { DateTime } from "luxon";
import type { Host, MeetingType } from "@prisma/client";
import { prisma } from "./db";
import { calendar } from "./calendar";
import type { BusyInterval } from "./calendar-types";
import { parseWeeklyHours, toMinutes, type WeeklyHours } from "./types";

export type SlotInput = {
  weeklyHours: WeeklyHours;
  hostTimezone: string;
  durationMinutes: number;
  bufferMinutes: number;
  /** Window to generate within (UTC). */
  rangeStart: Date;
  rangeEnd: Date;
  now: Date;
  minNoticeHours: number;
  daysInAdvance: number;
  dailyLimit?: number | null;
  busy: BusyInterval[];
  /** Live bookings per host-local ISO date (yyyy-MM-dd), for dailyLimit. */
  dayCounts?: Map<string, number>;
};

/**
 * Pure slot generator. All wall-clock math runs through Luxon in the host timezone,
 * so DST transitions shift the UTC instants automatically; output is always UTC.
 */
export function generateSlots(input: SlotInput): Date[] {
  const {
    weeklyHours,
    hostTimezone,
    durationMinutes,
    bufferMinutes,
    rangeStart,
    rangeEnd,
    now,
    minNoticeHours,
    daysInAdvance,
    dailyLimit,
    busy,
    dayCounts,
  } = input;

  if (durationMinutes <= 0) return [];

  const earliestMs = Math.max(
    rangeStart.getTime(),
    now.getTime() + minNoticeHours * 3_600_000
  );
  const latestMs = Math.min(
    rangeEnd.getTime(),
    now.getTime() + daysInAdvance * 86_400_000
  );
  if (earliestMs >= latestMs) return [];

  const bufferMs = Math.max(0, bufferMinutes) * 60_000;
  const durationMs = durationMinutes * 60_000;

  // Walk host-local calendar days covering the window (pad a day each side so a
  // window that starts mid-day still sees that day's earlier ranges).
  let day = DateTime.fromMillis(earliestMs, { zone: hostTimezone })
    .startOf("day")
    .minus({ days: 1 });
  const lastDay = DateTime.fromMillis(latestMs, { zone: hostTimezone })
    .startOf("day")
    .plus({ days: 1 });

  const slots: Date[] = [];
  let guard = 0;

  while (day <= lastDay && guard++ < 400) {
    const weekdayKey = String(day.weekday === 7 ? 0 : day.weekday); // Luxon: 1=Mon..7=Sun
    const ranges = weeklyHours[weekdayKey] ?? [];
    const dateKey = day.toFormat("yyyy-MM-dd");

    const usedToday = dayCounts?.get(dateKey) ?? 0;
    const limitReached = typeof dailyLimit === "number" && dailyLimit > 0 && usedToday >= dailyLimit;

    if (!limitReached) {
      for (const range of ranges) {
        const startMin = toMinutes(range.start);
        const endMin = toMinutes(range.end);
        if (endMin <= startMin) continue;

        const windowStart = day.plus({ minutes: startMin });
        const windowEnd = day.plus({ minutes: endMin });

        let cursor = windowStart;
        let innerGuard = 0;

        while (cursor.plus({ minutes: durationMinutes }) <= windowEnd && innerGuard++ < 500) {
          const slotStartMs = cursor.toMillis();
          const slotEndMs = slotStartMs + durationMs;

          const inWindow = slotStartMs >= earliestMs && slotStartMs <= latestMs;

          if (inWindow) {
            const guardStart = slotStartMs - bufferMs;
            const guardEnd = slotEndMs + bufferMs;
            const blocked = busy.some(
              (b) => b.start.getTime() < guardEnd && b.end.getTime() > guardStart
            );
            if (!blocked) slots.push(new Date(slotStartMs));
          }

          cursor = cursor.plus({ minutes: durationMinutes });
        }
      }
    }

    day = day.plus({ days: 1 });
  }

  slots.sort((a, b) => a.getTime() - b.getTime());
  return slots;
}

/**
 * Pure check: does this instant land on the meeting type's published slot grid and
 * satisfy min-notice / days-in-advance? No IO, so it is safe inside a transaction.
 */
export function isSlotOnGrid(
  meetingType: Pick<
    MeetingType,
    | "weeklyHours"
    | "durationMinutes"
    | "bufferMinutes"
    | "minNoticeHours"
    | "daysInAdvance"
  >,
  hostTimezone: string,
  startTime: Date,
  now = new Date()
): boolean {
  const endTime = new Date(startTime.getTime() + meetingType.durationMinutes * 60_000);
  const slots = generateSlots({
    weeklyHours: parseWeeklyHours(meetingType.weeklyHours),
    hostTimezone,
    durationMinutes: meetingType.durationMinutes,
    bufferMinutes: meetingType.bufferMinutes,
    rangeStart: new Date(startTime.getTime() - 60_000),
    rangeEnd: new Date(endTime.getTime() + 60_000),
    now,
    minNoticeHours: meetingType.minNoticeHours,
    daysInAdvance: meetingType.daysInAdvance,
    dailyLimit: null,
    busy: [],
  });
  return slots.some((s) => s.getTime() === startTime.getTime());
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
      OR: [
        { status: "CONFIRMED" },
        // Unexpired holds only — expired holds are lazily treated as free.
        { status: "PENDING_PAYMENT", expiresAt: { gt: now } },
      ],
    },
    select: { startTime: true, endTime: true },
  });
  return rows.map((r) => ({ start: r.startTime, end: r.endTime }));
}

/** Per host-local-day counts of live bookings of one meeting type (for dailyLimit). */
export async function dailyBookingCounts(
  meetingTypeId: string,
  hostTimezone: string,
  rangeStart: Date,
  rangeEnd: Date,
  now = new Date(),
  excludeBookingId?: string
): Promise<Map<string, number>> {
  const rows = await prisma.booking.findMany({
    where: {
      meetingTypeId,
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      startTime: { gte: rangeStart, lt: rangeEnd },
      OR: [
        { status: "CONFIRMED" },
        { status: "PENDING_PAYMENT", expiresAt: { gt: now } },
      ],
    },
    select: { startTime: true },
  });

  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = DateTime.fromJSDate(r.startTime, { zone: hostTimezone }).toFormat("yyyy-MM-dd");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Full availability for a window. Throws if Google freebusy fails — callers MUST
 * fail closed (show no slots) rather than risk a double booking.
 */
export async function getAvailability(
  host: Host,
  meetingType: MeetingType,
  rangeStart: Date,
  rangeEnd: Date,
  now = new Date()
): Promise<Date[]> {
  // Pad the freebusy query by the buffer so events just outside the window still block.
  const pad = (meetingType.bufferMinutes + meetingType.durationMinutes) * 60_000;
  const queryStart = new Date(rangeStart.getTime() - pad);
  const queryEnd = new Date(rangeEnd.getTime() + pad);

  const [googleBusy, dbBusy, dayCounts] = await Promise.all([
    calendar().freeBusy(host, queryStart, queryEnd),
    liveBookingIntervals(host.id, queryStart, queryEnd, now),
    dailyBookingCounts(meetingType.id, host.timezone, queryStart, queryEnd, now),
  ]);

  return generateSlots({
    weeklyHours: parseWeeklyHours(meetingType.weeklyHours),
    hostTimezone: host.timezone,
    durationMinutes: meetingType.durationMinutes,
    bufferMinutes: meetingType.bufferMinutes,
    rangeStart,
    rangeEnd,
    now,
    minNoticeHours: meetingType.minNoticeHours,
    daysInAdvance: meetingType.daysInAdvance,
    dailyLimit: meetingType.dailyLimit,
    busy: [...googleBusy, ...dbBusy],
    dayCounts,
  });
}

/**
 * Is this exact instant a legal, currently-open slot? Used before creating any booking
 * so the API cannot be driven off-grid (e.g. 3:07am on a Sunday).
 */
export async function isSlotOpen(
  host: Host,
  meetingType: MeetingType,
  startTime: Date,
  now = new Date(),
  excludeBookingId?: string
): Promise<boolean> {
  const endTime = new Date(startTime.getTime() + meetingType.durationMinutes * 60_000);
  const pad = (meetingType.bufferMinutes + meetingType.durationMinutes) * 60_000;
  const queryStart = new Date(startTime.getTime() - pad);
  const queryEnd = new Date(endTime.getTime() + pad);

  const [googleBusy, dbBusy, dayCounts] = await Promise.all([
    calendar().freeBusy(host, queryStart, queryEnd),
    liveBookingIntervals(host.id, queryStart, queryEnd, now, excludeBookingId),
    dailyBookingCounts(
      meetingType.id,
      host.timezone,
      queryStart,
      queryEnd,
      now,
      excludeBookingId
    ),
  ]);

  const slots = generateSlots({
    weeklyHours: parseWeeklyHours(meetingType.weeklyHours),
    hostTimezone: host.timezone,
    durationMinutes: meetingType.durationMinutes,
    bufferMinutes: meetingType.bufferMinutes,
    // Generate only around the candidate instant.
    rangeStart: new Date(startTime.getTime() - 60_000),
    rangeEnd: new Date(endTime.getTime() + 60_000),
    now,
    minNoticeHours: meetingType.minNoticeHours,
    daysInAdvance: meetingType.daysInAdvance,
    dailyLimit: meetingType.dailyLimit,
    busy: [...googleBusy, ...dbBusy],
    dayCounts,
  });

  return slots.some((s) => s.getTime() === startTime.getTime());
}
