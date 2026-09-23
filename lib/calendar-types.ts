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

export type BusyInterval = {
  start: Date;
  end: Date;
  /** Where the block came from, for the admin troubleshooter. */
  source?: "calendar" | "booking";
  calendarId?: string;
};

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
  /** Extra invitees the booker added. */
  guestEmails?: string[];
  /** Free-text location (address, phone number, video link). */
  location?: string | null;
  /** Ask the calendar for a Google Meet link. Defaults to true. */
  createMeet?: boolean;
};

export type UpdateEventArgs = {
  startTime: Date;
  endTime: Date;
  summary?: string;
  description?: string;
};

export type RemoteEvent = {
  eventId: string;
  start: Date | null;
  end: Date | null;
  cancelled: boolean;
};

export type CalendarListEntry = { id: string; summary: string; primary: boolean };

export type CalendarPort = {
  /**
   * Busy blocks on the host calendar. MUST throw rather than return empty on
   * failure — every caller fails closed, and a silent empty array reads as
   * "totally free", which is how double bookings happen.
   *
   * `excludeEventId` (reschedule): leave out exactly that event on the destination
   * calendar. Freebusy merges overlapping events and carries no ids, so cutting the
   * booking's time range instead would also hide any other event inside it.
   */
  freeBusy(host: Host, timeMin: Date, timeMax: Date, excludeEventId?: string): Promise<BusyInterval[]>;

  /** Create the event, retrying transient failures. Auth failures are terminal. */
  createEventWithRetry(
    host: Host,
    args: CreateEventArgs,
    maxAttempts?: number
  ): Promise<CreatedEvent>;

  /** Move an existing event (reschedule). Attendees are notified by the calendar. */
  updateEvent(host: Host, eventId: string, args: UpdateEventArgs): Promise<void>;

  /** Remove the event. Already-gone counts as success. */
  deleteEvent(host: Host, eventId: string): Promise<void>;

  /** Read an event back (reconcile). null = it no longer exists. */
  getEvent(host: Host, eventId: string): Promise<RemoteEvent | null>;

  /** Calendars on the connected account, for conflict-calendar selection. */
  listCalendars(host: Host): Promise<CalendarListEntry[]>;
};
