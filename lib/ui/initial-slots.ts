/**
 * Server-side first paint of availability. The booking page used to render, hydrate,
 * then fetch /api/availability — a full extra round trip before any time appeared.
 * Pages now compute the bookable window's slots while rendering and hand them to the
 * calendar, which only goes to the network for months outside it or after a refresh.
 */
import type { Host } from "@prisma/client";
import { getAvailability, pausedMessage, type MeetingTypeFull } from "../availability";
import { hostBookingBlocked } from "../booking";

export type InitialSlots = { duration: number; until: string; at: number; slots: string[] };

const HORIZON_DAYS = 62;

export async function initialSlots(
  host: Host,
  mt: MeetingTypeFull,
  opts: { link?: string | null; duration?: number | null }
): Promise<InitialSlots | null> {
  // Single-use links and non-default durations have their own rules: let the client fetch.
  if (opts.link || (opts.duration && opts.duration !== mt.durationMinutes)) return null;
  if (hostBookingBlocked(host) || pausedMessage(host)) return null;
  const now = new Date();
  const until = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  try {
    const slots = await getAvailability(host, mt, now, until, { now });
    return { duration: mt.durationMinutes, until: until.toISOString(), at: now.getTime(), slots: slots.map((s) => s.toISOString()) };
  } catch {
    return null; // the client fetch shows the proper error state
  }
}
