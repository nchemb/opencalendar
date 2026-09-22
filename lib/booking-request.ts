/**
 * Shared parsing for every "create a booking" entry point (booking page, REST API,
 * MCP). Validates the raw body against the meeting type and returns a BookingInput.
 */
import type { Host } from "@prisma/client";
import type { MeetingTypeFull } from "./availability";
import type { BookingInput } from "./booking";
import { questionsOf } from "./meeting-types";
import { LOCATION_KINDS, type LocationOption } from "./types";
import {
  cleanString,
  isEmail,
  isValidTimezone,
  parseAnswers,
  parseGuests,
  parseInstant,
  parseUtm,
} from "./validate";

export type ParsedRequest = { ok: true; input: BookingInput } | { ok: false; error: string; code: string };

export function parseBookingRequest(body: Record<string, unknown>, mt: MeetingTypeFull, _host: Host): ParsedRequest {
  const name = cleanString(body.name, 120);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
  const timezone = body.timezone;
  const startTime = parseInstant(body.startTime);

  if (!name) return { ok: false, error: "Please enter your name.", code: "BAD_NAME" };
  if (!isEmail(email)) return { ok: false, error: "Please enter a valid email address.", code: "BAD_EMAIL" };
  if (!isValidTimezone(timezone)) return { ok: false, error: "Invalid timezone.", code: "BAD_TZ" };
  if (!startTime) return { ok: false, error: "Pick a time slot.", code: "BAD_TIME" };

  const answers = parseAnswers(body.answers, questionsOf(mt));
  if (!answers.ok) return { ok: false, error: answers.error, code: "BAD_ANSWER" };

  const guests = mt.allowGuests ? parseGuests(body.guests, mt.maxGuests, email!) : [];
  if (!Array.isArray(guests)) return { ok: false, error: guests.error, code: "BAD_GUESTS" };

  let location: LocationOption | null = null;
  if (body.location && typeof body.location === "object") {
    const l = body.location as Record<string, unknown>;
    if (!LOCATION_KINDS.includes(l.kind as LocationOption["kind"])) {
      return { ok: false, error: "Pick a meeting location.", code: "BAD_LOCATION" };
    }
    location = { kind: l.kind as LocationOption["kind"], value: cleanString(l.value, 500) };
    if (location.kind === "phone_invitee" && !location.value) {
      return { ok: false, error: "Enter the phone number to call you on.", code: "BAD_LOCATION" };
    }
  }

  const duration = body.durationMinutes === undefined || body.durationMinutes === null ? undefined : Number(body.durationMinutes);
  if (duration !== undefined && !Number.isInteger(duration)) {
    return { ok: false, error: "Invalid duration.", code: "BAD_DURATION" };
  }

  return {
    ok: true,
    input: {
      name,
      email: email!,
      timezone: timezone as string,
      answers: answers.answers,
      customAnswer: answers.display,
      startTime,
      durationMinutes: duration,
      guests,
      location,
      utm: parseUtm(body.utm),
      singleUseToken: cleanString(body.link, 100),
    },
  };
}

/** Public-safe view of a booking, returned to whoever created or manages it. */
export function publicBooking(b: {
  id: string;
  status: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  name: string;
  email: string;
  meetLink: string | null;
  cancelToken: string;
  location: unknown;
  guests: string[];
  amountCents: number | null;
  stripePaymentStatus: string | null;
  googleEventId: string | null;
}) {
  return {
    id: b.id,
    status: b.status,
    startTime: b.startTime.toISOString(),
    endTime: b.endTime.toISOString(),
    timezone: b.timezone,
    name: b.name,
    email: b.email,
    meetLink: b.meetLink,
    manageToken: b.status === "CONFIRMED" ? b.cancelToken : null,
    location: b.location ?? null,
    guests: b.guests,
    amountCents: b.amountCents,
    paymentStatus: b.stripePaymentStatus,
    calendarPending: b.status === "CONFIRMED" && !b.googleEventId,
  };
}
