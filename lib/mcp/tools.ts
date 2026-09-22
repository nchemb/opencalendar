/**
 * MCP tool definitions. Each handler reuses the exact same booking-engine
 * functions as the booking page and the REST API (lib/booking.ts,
 * lib/booking-request.ts) so an agent can never take a path the UI couldn't.
 */
import { DateTime } from "luxon";
import { prisma } from "../db";
import {
  cancelBooking,
  createFreeBooking,
  hostBookingBlocked,
  priceFor,
  requireHost,
  rescheduleBooking,
  resolveDuration,
  resolveSingleUseLink,
} from "../booking";
import { parseBookingRequest, publicBooking } from "../booking-request";
import { getAvailability, meetingTypeInclude, pausedMessage, type MeetingTypeFull } from "../availability";
import { errorMessage } from "../logger";
import { findActiveMeetingType, toPublic } from "../meeting-types";
import { appUrl } from "../env";
import { isValidTimezone } from "../validate";

export type ToolContent = { type: "text"; text: string };
export type ToolResult = { content: ToolContent[]; structuredContent?: unknown; isError?: boolean };

export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
};

function text(s: string): ToolResult {
  return { content: [{ type: "text", text: s }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function bookingErrorMessage(err: unknown): Promise<string> {
  const { SlotTakenError, InvalidSlotError, BookingUnavailableError, ChangeNotAllowedError } = await import("../booking");
  if (
    err instanceof SlotTakenError ||
    err instanceof InvalidSlotError ||
    err instanceof BookingUnavailableError ||
    err instanceof ChangeNotAllowedError
  ) {
    return err.message;
  }
  return `Something went wrong: ${errorMessage(err)}`;
}

function formatSlotsByDay(slots: Date[], tz: string, cap = 200): string {
  if (!slots.length) return "No open times in that range.";
  const byDay = new Map<string, string[]>();
  for (const s of slots.slice(0, cap)) {
    const d = DateTime.fromJSDate(s).setZone(tz);
    const day = d.toFormat("EEE, MMM d");
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(d.toFormat("h:mm a"));
  }
  const lines = [...byDay.entries()].map(([day, times]) => `${day}: ${times.join(", ")}`);
  const more = slots.length > cap ? `\n(+${slots.length - cap} more — narrow the date range)` : "";
  return lines.join("\n") + more;
}

export const TOOLS: Tool[] = [
  {
    name: "list_event_types",
    description:
      "List every bookable event type (meeting link) on this BookKit instance: name, slug, duration, " +
      "price and questions asked. Call this first to find the `slug` needed by every other tool.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const host = await requireHost();
      const rows = await prisma.meetingType.findMany({
        where: { hostId: host.id, active: true },
        include: meetingTypeInclude,
        orderBy: { position: "asc" },
      });
      const types = (rows as MeetingTypeFull[]).map((mt) => toPublic(mt, host));
      const lines = types.map((t) => {
        const price = t.priceCents ? `$${(t.priceCents / 100).toFixed(2)} ${t.currency.toUpperCase()}` : "free";
        return `- ${t.name} (slug: ${t.slug}) — ${t.durationMinutes} min, ${price}`;
      });
      return {
        content: [{ type: "text", text: lines.length ? lines.join("\n") : "No active event types." }],
        structuredContent: { eventTypes: types },
      };
    },
  },
  {
    name: "find_available_times",
    description:
      "Find open booking slots for one event type in a date range. Returns times in the given timezone. " +
      "Use this before book_meeting to show the person real options.",
    inputSchema: {
      type: "object",
      required: ["slug", "from", "to"],
      properties: {
        slug: { type: "string", description: "Event type slug from list_event_types" },
        from: { type: "string", description: "Start date, yyyy-MM-dd" },
        to: { type: "string", description: "End date, yyyy-MM-dd (inclusive), at most 70 days after `from`" },
        timezone: { type: "string", description: "IANA timezone to display times in, e.g. America/Chicago. Defaults to the host's schedule timezone." },
        duration: { type: "integer", description: "Duration in minutes, only for event types offering more than one" },
      },
    },
    handler: async (args) => {
      const slug = String(args.slug ?? "");
      const found = await findActiveMeetingType(slug);
      if (!found) return errorResult(`No event type with slug "${slug}". Call list_event_types first.`);
      const { meetingType, host } = found;
      const tz = typeof args.timezone === "string" && isValidTimezone(args.timezone) ? args.timezone : meetingType.schedule?.timezone || host.timezone;

      const fromDt = DateTime.fromISO(String(args.from ?? ""), { zone: tz });
      const toDt = DateTime.fromISO(String(args.to ?? ""), { zone: tz });
      if (!fromDt.isValid || !toDt.isValid) return errorResult("`from` and `to` must be dates like 2026-10-01.");
      const rangeStart = fromDt.startOf("day").toUTC().toJSDate();
      const rangeEnd = toDt.endOf("day").toUTC().toJSDate();
      if (rangeEnd <= rangeStart || rangeEnd.getTime() - rangeStart.getTime() > 70 * 86_400_000) {
        return errorResult("Date range must be positive and no more than 70 days.");
      }

      const paused = pausedMessage(host);
      if (paused) return text(paused);
      if (hostBookingBlocked(host)) return errorResult("Booking is temporarily unavailable (calendar disconnected).");

      try {
        const durationArg = typeof args.duration === "number" ? args.duration : undefined;
        const duration = resolveDuration(meetingType, durationArg);
        const slots = await getAvailability(host, meetingType, rangeStart, rangeEnd, { durationMinutes: duration });
        return {
          content: [{ type: "text", text: formatSlotsByDay(slots, tz) }],
          structuredContent: { slots: slots.map((s) => s.toISOString()), timezone: tz, durationMinutes: duration },
        };
      } catch (err) {
        return errorResult(await bookingErrorMessage(err));
      }
    },
  },
  {
    name: "book_meeting",
    description:
      "Book a meeting on a free event type at an exact open slot (get one from find_available_times first). " +
      "If the event type requires payment, this returns the booking page URL instead of booking — send the " +
      "person there to pay; it cannot be booked through this tool.",
    inputSchema: {
      type: "object",
      required: ["slug", "name", "email", "timezone", "startTime"],
      properties: {
        slug: { type: "string" },
        name: { type: "string", description: "Invitee's full name" },
        email: { type: "string" },
        timezone: { type: "string", description: "Invitee's IANA timezone" },
        startTime: { type: "string", description: "Exact UTC ISO instant from find_available_times, e.g. 2026-10-01T14:00:00.000Z" },
        durationMinutes: { type: "integer" },
        guests: { type: "array", items: { type: "string" }, description: "Additional guest emails" },
        answers: { type: "object", description: "Answers to the event type's questions, keyed by question id" },
      },
    },
    handler: async (args) => {
      const slug = String(args.slug ?? "");
      const found = await findActiveMeetingType(slug);
      if (!found) return errorResult(`No event type with slug "${slug}".`);
      const { meetingType, host } = found;

      const parsed = parseBookingRequest(args, meetingType, host);
      if (!parsed.ok) return errorResult(parsed.error);

      try {
        const link = await resolveSingleUseLink(meetingType, parsed.input.singleUseToken);
        const amount = priceFor(meetingType, resolveDuration(meetingType, parsed.input.durationMinutes, link), link);
        if (amount) {
          const url = `${appUrl()}/${meetingType.slug}`;
          return {
            content: [{ type: "text", text: `"${meetingType.name}" requires payment ($${(amount / 100).toFixed(2)}). Send the person here to book and pay: ${url}` }],
            structuredContent: { requiresPayment: true, bookingUrl: url },
          };
        }
        const booking = await createFreeBooking(host, meetingType, parsed.input);
        const when = DateTime.fromJSDate(booking.startTime).setZone(parsed.input.timezone).toFormat("EEE, MMM d 'at' h:mm a ZZZZ");
        return {
          content: [{ type: "text", text: `Booked "${meetingType.name}" for ${booking.name} on ${when}. Booking id: ${booking.id}.` }],
          structuredContent: { booking: publicBooking(booking) },
        };
      } catch (err) {
        return errorResult(await bookingErrorMessage(err));
      }
    },
  },
  {
    name: "cancel_booking",
    description: "Cancel an existing booking by its id (from book_meeting or list_upcoming_bookings). Refunds automatically if it was paid.",
    inputSchema: {
      type: "object",
      required: ["bookingId"],
      properties: { bookingId: { type: "string" }, reason: { type: "string" } },
    },
    handler: async (args) => {
      const id = String(args.bookingId ?? "");
      const booking = await prisma.booking.findUnique({ where: { id } });
      if (!booking) return errorResult(`No booking with id "${id}".`);
      try {
        const r = await cancelBooking(id, "host", { reason: typeof args.reason === "string" ? args.reason : undefined });
        return {
          content: [{ type: "text", text: `Cancelled.${r.refunded ? " Refunded in full." : ""}` }],
          structuredContent: { booking: publicBooking(r.booking), refunded: r.refunded },
        };
      } catch (err) {
        return errorResult(await bookingErrorMessage(err));
      }
    },
  },
  {
    name: "reschedule_booking",
    description: "Move an existing booking to a new open slot (get one from find_available_times first).",
    inputSchema: {
      type: "object",
      required: ["bookingId", "startTime"],
      properties: { bookingId: { type: "string" }, startTime: { type: "string" }, reason: { type: "string" } },
    },
    handler: async (args) => {
      const id = String(args.bookingId ?? "");
      const booking = await prisma.booking.findUnique({ where: { id } });
      if (!booking) return errorResult(`No booking with id "${id}".`);
      const newStart = new Date(String(args.startTime ?? ""));
      if (Number.isNaN(newStart.getTime())) return errorResult("startTime must be an ISO instant.");
      try {
        const updated = await rescheduleBooking(id, newStart, "host", {
          reason: typeof args.reason === "string" ? args.reason : undefined,
        });
        const when = DateTime.fromJSDate(updated.startTime).setZone(updated.timezone).toFormat("EEE, MMM d 'at' h:mm a ZZZZ");
        return {
          content: [{ type: "text", text: `Rescheduled to ${when}.` }],
          structuredContent: { booking: publicBooking(updated) },
        };
      } catch (err) {
        return errorResult(await bookingErrorMessage(err));
      }
    },
  },
  {
    name: "list_upcoming_bookings",
    description: "List confirmed upcoming bookings, soonest first.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO instant; defaults to now" },
        to: { type: "string", description: "ISO instant; defaults to 30 days from `from`" },
        limit: { type: "integer", default: 20, maximum: 100 },
      },
    },
    handler: async (args) => {
      const from = typeof args.from === "string" ? new Date(args.from) : new Date();
      const to = typeof args.to === "string" ? new Date(args.to) : new Date(from.getTime() + 30 * 86_400_000);
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
      const rows = await prisma.booking.findMany({
        where: { status: "CONFIRMED", startTime: { gte: from, lte: to } },
        orderBy: { startTime: "asc" },
        take: limit,
        include: { meetingType: { select: { slug: true, name: true } } },
      });
      const lines = rows.map((b) => `- ${b.name} <${b.email}> — ${b.meetingType.name} at ${b.startTime.toISOString()} (id: ${b.id})`);
      return {
        content: [{ type: "text", text: lines.length ? lines.join("\n") : "No upcoming bookings in that range." }],
        structuredContent: { bookings: rows.map((b) => ({ ...publicBooking(b), meetingType: b.meetingType })) },
      };
    },
  },
];

export function findTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}
