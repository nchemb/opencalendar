import type { Host, MeetingType } from "@prisma/client";
import { prisma } from "./db";
import type { PublicMeetingType } from "./types";

export async function findActiveMeetingType(
  slug: string
): Promise<{ meetingType: MeetingType; host: Host } | null> {
  const meetingType = await prisma.meetingType.findUnique({
    where: { slug },
    include: { host: true },
  });
  if (!meetingType || !meetingType.active) return null;
  const { host, ...rest } = meetingType;
  return { meetingType: rest as MeetingType, host };
}

export function toPublic(meetingType: MeetingType, host: Host): PublicMeetingType {
  return {
    slug: meetingType.slug,
    name: meetingType.name,
    description: meetingType.description,
    durationMinutes: meetingType.durationMinutes,
    priceCents: meetingType.priceCents,
    currency: meetingType.currency,
    color: meetingType.color,
    customQuestion: meetingType.customQuestion,
    displayMode: meetingType.displayMode,
    hostName: host.displayName || host.email,
    hostTimezone: host.timezone,
  };
}

/** True when bookings cannot currently be taken (Google not connected / revoked). */
export function hostBookingBlocked(host: Host): boolean {
  return !host.googleRefreshToken || Boolean(host.googleAuthError);
}
