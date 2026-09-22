/**
 * In-memory CalendarPort.
 *
 * Two jobs, one implementation:
 *  1. The public demo instance (BOOKKIT_DEMO_MODE=1) — strangers can book against
 *     it without BookKit touching anyone's real Google Calendar.
 *  2. The test suite — the fault-injection controls below let integration tests
 *     drive the failure paths (calendar down, token revoked) that are impossible
 *     to trigger reliably against the live Google API.
 *
 * State is per-process and deliberately volatile. On the demo instance a
 * serverless cold start wiping the fake calendar is a feature, not a bug.
 */
import type { Host } from "@prisma/client";
import {
  GoogleApiError,
  GoogleAuthError,
  type BusyInterval,
  type CalendarPort,
  type CreateEventArgs,
  type CreatedEvent,
  type RemoteEvent,
  type UpdateEventArgs,
} from "./calendar-types";

type MemoryEvent = {
  eventId: string;
  bookingId: string;
  start: Date;
  end: Date;
  summary: string;
  attendeeEmail: string;
  guestEmails: string[];
};

type Faults = {
  /** Fail the next N createEvent attempts with a transient error. */
  failCreateAttempts: number;
  /** Every freeBusy call throws until cleared. */
  freeBusyError: Error | null;
  /** Every call throws GoogleAuthError until cleared (simulates a revoked token). */
  authError: Error | null;
  /** Every deleteEvent call throws until cleared. */
  deleteError: Error | null;
  /** Every updateEvent call throws until cleared. */
  updateError: Error | null;
};

const events = new Map<string, MemoryEvent>();
/** Busy blocks not owned by BookKit — i.e. what the host put on their calendar by hand. */
let externalBusy: BusyInterval[] = [];
let seq = 0;

const faults: Faults = {
  failCreateAttempts: 0,
  freeBusyError: null,
  authError: null,
  deleteError: null,
  updateError: null,
};

function overlaps(a: BusyInterval, start: Date, end: Date): boolean {
  return a.start.getTime() < end.getTime() && a.end.getTime() > start.getTime();
}

export const memoryCalendar: CalendarPort = {
  async freeBusy(_host: Host, timeMin: Date, timeMax: Date): Promise<BusyInterval[]> {
    if (faults.authError) throw faults.authError;
    if (faults.freeBusyError) throw faults.freeBusyError;

    const own = [...events.values()].map((e) => ({
      start: e.start,
      end: e.end,
      source: "calendar" as const,
      calendarId: "primary",
    }));
    return [...externalBusy, ...own].filter((b) => overlaps(b, timeMin, timeMax));
  },

  async createEventWithRetry(
    _host: Host,
    args: CreateEventArgs,
    maxAttempts = 3
  ): Promise<CreatedEvent> {
    if (faults.authError) throw faults.authError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (faults.failCreateAttempts > 0) {
        faults.failCreateAttempts -= 1;
        if (attempt === maxAttempts) {
          throw new GoogleApiError("event insert failed: injected fault");
        }
        continue;
      }

      const eventId = `mem-evt-${++seq}`;
      events.set(eventId, {
        eventId,
        bookingId: args.bookingId,
        start: args.startTime,
        end: args.endTime,
        summary: args.summary,
        attendeeEmail: args.attendeeEmail,
        guestEmails: args.guestEmails ?? [],
      });
      return {
        eventId,
        meetLink: `https://meet.example.com/demo-${eventId}`,
        htmlLink: `https://calendar.example.com/event/${eventId}`,
      };
    }

    throw new GoogleApiError("event insert failed: injected fault");
  },

  async updateEvent(_host: Host, eventId: string, args: UpdateEventArgs): Promise<void> {
    if (faults.authError) throw faults.authError;
    if (faults.updateError) throw faults.updateError;
    const e = events.get(eventId);
    if (!e) throw new GoogleApiError("event update failed: not found");
    e.start = args.startTime;
    e.end = args.endTime;
  },

  async deleteEvent(_host: Host, eventId: string): Promise<void> {
    if (faults.authError) throw faults.authError;
    if (faults.deleteError) throw faults.deleteError;
    events.delete(eventId); // already gone is success
  },

  async getEvent(_host: Host, eventId: string): Promise<RemoteEvent | null> {
    if (faults.authError) throw faults.authError;
    const e = events.get(eventId);
    return e ? { eventId, start: e.start, end: e.end, cancelled: false } : null;
  },

  async listCalendars() {
    if (faults.authError) throw faults.authError;
    return [
      { id: "primary", summary: "Primary", primary: true },
      { id: "personal@example.test", summary: "Personal", primary: false },
    ];
  },
};

/**
 * Test + demo controls. Never called from a request path.
 */
export const memoryCalendarControl = {
  reset() {
    events.clear();
    externalBusy = [];
    seq = 0;
    faults.failCreateAttempts = 0;
    faults.freeBusyError = null;
    faults.authError = null;
    faults.deleteError = null;
    faults.updateError = null;
  },

  /** Simulate events the host added by hand outside BookKit. */
  setExternalBusy(intervals: BusyInterval[]) {
    externalBusy = intervals;
  },

  /** Next `n` createEvent attempts fail transiently. n >= maxAttempts exhausts the retry. */
  failCreateAttempts(n: number) {
    faults.failCreateAttempts = n;
  },

  /** freeBusy throws until cleared — the "Google is down" path. */
  breakFreeBusy(err: Error = new GoogleApiError("freebusy failed: injected fault")) {
    faults.freeBusyError = err;
  },

  /** Everything throws GoogleAuthError — the "refresh token revoked" path. */
  breakAuth(err: Error = new GoogleAuthError("Google Calendar authorization has expired.")) {
    faults.authError = err;
  },

  breakDelete(err: Error = new GoogleApiError("event delete failed: injected fault")) {
    faults.deleteError = err;
  },

  breakUpdate(err: Error = new GoogleApiError("event update failed: injected fault")) {
    faults.updateError = err;
  },

  /** Simulate the host deleting or moving an event by hand in Google. */
  deleteExternally(eventId: string) {
    events.delete(eventId);
  },
  moveExternally(eventId: string, start: Date, end: Date) {
    const e = events.get(eventId);
    if (e) {
      e.start = start;
      e.end = end;
    }
  },

  listEvents(): MemoryEvent[] {
    return [...events.values()];
  },

  eventCount(): number {
    return events.size;
  },
};
