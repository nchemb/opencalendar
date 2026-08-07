/**
 * Fixtures for the integration suite.
 *
 * Meeting types default to every day 09:00–17:00 host-local with no minimum
 * notice, so `slotAt(...)` can hand back a legal slot without any test having to
 * reason about the availability grid.
 */
import type { Host, MeetingType } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../../lib/db";
import type { WeeklyHours } from "../../lib/types";

export const HOST_TZ = "America/Chicago";

const ALL_WEEK: WeeklyHours = Object.fromEntries(
  ["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "09:00", end: "17:00" }]])
);

export async function createHost(overrides: Partial<Host> = {}): Promise<Host> {
  return prisma.host.create({
    data: {
      email: "host@example.test",
      timezone: HOST_TZ,
      displayName: "Test Host",
      // Present so the Google code path would consider the host connected. The
      // memory calendar ignores it entirely.
      googleRefreshToken: "test-refresh-token",
      googleConnectedAt: new Date(),
      ...overrides,
    },
  });
}

export async function createMeetingType(
  host: Host,
  overrides: Partial<MeetingType> = {}
): Promise<MeetingType> {
  const slug = (overrides.slug as string) ?? `type-${Math.random().toString(36).slice(2, 9)}`;
  return prisma.meetingType.create({
    data: {
      hostId: host.id,
      slug,
      name: "Test Meeting",
      description: "A meeting used by the test suite.",
      durationMinutes: 30,
      priceCents: null,
      currency: "usd",
      weeklyHours: ALL_WEEK as object,
      daysInAdvance: 30,
      minNoticeHours: 0,
      bufferMinutes: 0,
      dailyLimit: null,
      questions: undefined,
      displayMode: "popup",
      active: true,
      ...overrides,
    } as never,
  });
}

/** A paid meeting type. Same grid, with a price. */
export async function createPaidMeetingType(
  host: Host,
  overrides: Partial<MeetingType> = {}
): Promise<MeetingType> {
  return createMeetingType(host, { priceCents: 6900, ...overrides });
}

/**
 * A legal slot on the default grid: `daysAhead` days from now at `hourLocal`
 * host-local time, snapped to the top of the hour so it always lands on the
 * 30-minute boundary the generator produces.
 */
export function slotAt(hourLocal = 10, daysAhead = 2, tz = HOST_TZ): Date {
  return DateTime.now()
    .setZone(tz)
    .plus({ days: daysAhead })
    .set({ hour: hourLocal, minute: 0, second: 0, millisecond: 0 })
    .toJSDate();
}

export function bookingInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "Ada Lovelace",
    email: "ada@example.test",
    timezone: "America/New_York",
    startTime: slotAt(),
    ...overrides,
  } as {
    name: string;
    email: string;
    timezone: string;
    startTime: Date;
    answers?: { label: string; answer: string }[];
    customAnswer?: string | null;
  };
}
