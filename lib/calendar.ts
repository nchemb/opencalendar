/**
 * Calendar backend selection.
 *
 * Everything in the app that touches a calendar goes through `calendar()`.
 * Production returns the Google-backed port; demo mode and the test suite return
 * the in-memory one. To add a backend, implement CalendarPort and branch here.
 */
import { isDemoMode } from "./env";
import { googleCalendar } from "./google";
import { memoryCalendar } from "./calendar-memory";
import type { CalendarPort } from "./calendar-types";

export function calendar(): CalendarPort {
  return isDemoMode() ? memoryCalendar : googleCalendar;
}

export type {
  BusyInterval,
  CalendarPort,
  CreateEventArgs,
  CreatedEvent,
} from "./calendar-types";
export { GoogleApiError, GoogleAuthError } from "./calendar-types";
