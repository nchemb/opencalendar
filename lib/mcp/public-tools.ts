/**
 * Public (keyless) MCP toolset. Exposes only event types the host marked
 * `agentBookable` (never secret ones), and only what the booking page already
 * shows. Free bookings go through createFreeBooking — the same lock + live
 * calendar re-check as a human booking. Paid types never book here: they return
 * a booking-page URL with the slot preselected so a human pays.
 */
import type { Host } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { createFreeBooking, priceFor, requireHost, resolveDuration } from "../booking";
import { parseBookingRequest } from "../booking-request";
import { meetingTypeInclude, type MeetingTypeFull } from "../availability";
import { manageUrl } from "../emails";
import { appUrl } from "../env";
import { findActiveMeetingType, questionsOf } from "../meeting-types";
import { rateLimit } from "../rate-limit";
import { durationChoices } from "../types";
import { cleanString } from "../validate";
import { bookingErrorMessage, errorResult, findTimes, type Tool } from "./tools";

export const PUBLIC_MCP_PATH = "/api/mcp/public";

export const PUBLIC_INSTRUCTIONS =
  "Books meetings with this host. Call list_event_types, then find_available_times, then book_meeting " +
  "with the invitee's real name and email. Free meetings are booked directly and the invitee gets the " +
  "confirmation email and calendar invite. Paid meetings return a checkout URL: give it to the person to pay.";

const isAgentBookable = (mt: { active: boolean; secret: boolean; agentBookable: boolean }) =>
  mt.active && !mt.secret && mt.agentBookable;

export async function listAgentBookable(): Promise<{ host: Host; types: MeetingTypeFull[] }> {
  const host = await requireHost();
  const types = (await prisma.meetingType.findMany({
    where: { hostId: host.id, active: true, secret: false, agentBookable: true },
    include: meetingTypeInclude,
    orderBy: { position: "asc" },
  })) as MeetingTypeFull[];
  return { host, types };
}

async function findAgentBookable(slug: string) {
  const found = await findActiveMeetingType(slug);
  return found && isAgentBookable(found.meetingType) ? found : null;
}

/** What an agent sees for one event type — nothing beyond the public booking page. */
export function agentView(mt: MeetingTypeFull, host: Host) {
  return {
    slug: mt.slug,
    name: mt.name,
    description: mt.description,
    durations: durationChoices(mt).map((d) => ({ minutes: d.minutes, priceCents: d.priceCents ?? null })),
    currency: mt.currency,
    requiresPayment: durationChoices(mt).some((d) => (d.priceCents ?? 0) > 0),
    timezone: mt.schedule?.timezone || host.timezone,
    questions: questionsOf(mt),
    bookingUrl: `${appUrl()}/${mt.slug}`,
  };
}

function priceText(cents: number | null | undefined, currency: string) {
  return cents ? `$${(cents / 100).toFixed(2)} ${currency.toUpperCase()}` : "free";
}

/** Booking-page URL with the slot and invitee preselected (see lib/ui/params.ts `time`). */
export function checkoutUrl(slug: string, p: { startTime: Date; timezone: string; duration?: number; name?: string; email?: string }) {
  const q = new URLSearchParams({
    time: p.startTime.toISOString(),
    date: DateTime.fromJSDate(p.startTime).setZone(p.timezone).toISODate()!,
    tz: p.timezone,
  });
  if (p.duration) q.set("duration", String(p.duration));
  if (p.name) q.set("name", p.name);
  if (p.email) q.set("email", p.email);
  q.set("ref", "agent");
  return `${appUrl()}/${slug}?${q}`;
}

export const PUBLIC_TOOLS: Tool[] = [
  {
    name: "list_event_types",
    description:
      "List the meetings you can book with this host: slug, name, durations, price, description, timezone and " +
      "the questions the booking asks. Call this first; every other tool needs a `slug` from here.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const { host, types } = await listAgentBookable();
      const views = types.map((mt) => agentView(mt, host));
      const lines = views.map(
        (v) =>
          `- ${v.name} (slug: ${v.slug}) — ${v.durations.map((d) => `${d.minutes} min ${priceText(d.priceCents, v.currency)}`).join(" / ")}` +
          (v.requiresPayment ? " — paid: book_meeting returns a checkout link" : "")
      );
      return {
        content: [{ type: "text", text: lines.length ? lines.join("\n") : "No meetings are open to agent booking." }],
        structuredContent: { eventTypes: views },
      };
    },
  },
  {
    name: "find_available_times",
    description: "Find open slots for one event type in a date range (at most 70 days). Times are shown in `timezone`.",
    inputSchema: {
      type: "object",
      required: ["slug", "from", "to"],
      properties: {
        slug: { type: "string", description: "Event type slug from list_event_types" },
        from: { type: "string", description: "Start date, yyyy-MM-dd" },
        to: { type: "string", description: "End date, yyyy-MM-dd (inclusive)" },
        timezone: { type: "string", description: "Invitee's IANA timezone, e.g. America/New_York" },
        duration: { type: "integer", description: "Minutes, only for event types offering more than one duration" },
      },
    },
    handler: async (args) => {
      const slug = String(args.slug ?? "");
      const found = await findAgentBookable(slug);
      if (!found) return errorResult(`No bookable event type "${slug}". Call list_event_types first.`);
      return findTimes(found, args);
    },
  },
  {
    name: "book_meeting",
    description:
      "Book an open slot (from find_available_times) for a named person. Free meetings are booked immediately and " +
      "the person receives the confirmation email and calendar invite. Paid meetings are NOT booked: you get a " +
      "checkoutUrl with the slot preselected — give it to the person to pay. Use the person's real name and email.",
    inputSchema: {
      type: "object",
      required: ["slug", "name", "email", "timezone", "startTime"],
      properties: {
        slug: { type: "string" },
        name: { type: "string", description: "Invitee's full name" },
        email: { type: "string", description: "Invitee's email — the confirmation goes here" },
        timezone: { type: "string", description: "Invitee's IANA timezone" },
        startTime: { type: "string", description: "Exact UTC ISO instant from find_available_times" },
        durationMinutes: { type: "integer" },
        answers: { type: "object", description: "Answers to the event type's questions, keyed by question id" },
        notes: { type: "string", description: "Optional context for the host" },
        agentName: { type: "string", description: "Name of the agent or app booking, e.g. the assistant's product name" },
      },
    },
    handler: async (args, ctx) => {
      if (!rateLimit(`mcp-public-book:${ctx?.ip ?? "unknown"}`, { limit: 5, windowMs: 60 * 60_000 }).allowed) {
        return errorResult("Too many booking attempts from this address. Try again later.");
      }
      const slug = String(args.slug ?? "");
      const found = await findAgentBookable(slug);
      if (!found) return errorResult(`No bookable event type "${slug}". Call list_event_types first.`);
      const { meetingType, host } = found;

      // Only the fields a booking page would send; no single-use links, guests or utm.
      const parsed = parseBookingRequest(
        { name: args.name, email: args.email, timezone: args.timezone, startTime: args.startTime, durationMinutes: args.durationMinutes, answers: args.answers },
        meetingType,
        host
      );
      if (!parsed.ok) return errorResult(parsed.error);
      const input = parsed.input;

      try {
        const duration = resolveDuration(meetingType, input.durationMinutes);
        const amount = priceFor(meetingType, duration);
        if (amount) {
          const url = checkoutUrl(meetingType.slug, {
            startTime: input.startTime,
            timezone: input.timezone,
            duration: duration === meetingType.durationMinutes ? undefined : duration,
            name: input.name,
            email: input.email,
          });
          return {
            content: [
              {
                type: "text",
                text: `"${meetingType.name}" costs ${priceText(amount, meetingType.currency)} and needs a human to pay. Nothing is booked yet. Send ${input.name} this link; the time is preselected: ${url}`,
              },
            ],
            structuredContent: { requiresPayment: true, checkoutUrl: url, amountCents: amount, currency: meetingType.currency },
          };
        }

        const notes = cleanString(args.notes, 2000);
        if (notes) {
          input.answers = [...(input.answers ?? []), { id: "agent_notes", label: "Notes", answer: notes }];
          input.customAnswer = input.answers.map((a) => `${a.label}\n${a.answer}`).join("\n\n");
        }
        input.agent = { client: cleanString(args.agentName, 80) };

        const booking = await createFreeBooking(host, meetingType, input);
        const when = DateTime.fromJSDate(booking.startTime).setZone(input.timezone).toFormat("EEE, MMM d 'at' h:mm a ZZZZ");
        const manage = manageUrl(booking);
        return {
          content: [
            {
              type: "text",
              text: `Booked "${meetingType.name}" for ${booking.name} on ${when}. A confirmation email is on its way to ${booking.email}. Reschedule or cancel: ${manage}`,
            },
          ],
          structuredContent: {
            booking: {
              id: booking.id,
              status: booking.status,
              startTime: booking.startTime.toISOString(),
              endTime: booking.endTime.toISOString(),
              timezone: booking.timezone,
              meetLink: booking.meetLink,
              manageUrl: manage,
            },
          },
        };
      } catch (err) {
        return errorResult(await bookingErrorMessage(err));
      }
    },
  },
];
