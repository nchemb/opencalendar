/**
 * The calendar seam.
 *
 * BookKit talks to a calendar through this interface, never to Google directly.
 * Two implementations ship: `lib/google.ts` (real Google Calendar) and
 * `lib/calendar-memory.ts` (in-memory, used by the public demo instance and the
 * test suite). `lib/calendar.ts` picks between them.
 *
 * If you want to add a backend — CalDAV, Outlook, Fastmail — implement
 * `CalendarPort` and register it there. Nothing else in the app needs to change.
 */
import type { Host } from "@prisma/client";

/** The host must reconnect their calendar before bookings can work again. */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/** Transient/unknown calendar failure. Callers fail closed. */
export class GoogleApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export type BusyInterval = { start: Date; end: Date };

export type CreatedEvent = {
  eventId: string;
  meetLink: string | null;
  htmlLink: string | null;
};

export type CreateEventArgs = {
  bookingId: string;
  summary: string;
  description: string;
  startTime: Date;
  endTime: Date;
  attendeeEmail: string;
  attendeeName: string;
};

export type CalendarPort = {
  /**
   * Busy blocks on the host calendar. MUST throw rather than return empty on
   * failure — every caller fails closed, and a silent empty array reads as
   * "totally free", which is how double bookings happen.
   */
  freeBusy(host: Host, timeMin: Date, timeMax: Date): Promise<BusyInterval[]>;

  /** Create the event, retrying transient failures. Auth failures are terminal. */
  createEventWithRetry(
    host: Host,
    args: CreateEventArgs,
    maxAttempts?: number
  ): Promise<CreatedEvent>;

  /** Remove the event. Already-gone counts as success. */
  deleteEvent(host: Host, eventId: string): Promise<void>;
};
