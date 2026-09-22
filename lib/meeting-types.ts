import type { Brand, Host } from "@prisma/client";
import { prisma } from "./db";
import { meetingTypeInclude, type MeetingTypeFull } from "./availability";
import {
  durationChoices,
  parseLocations,
  parseQuestions,
  type BookingQuestion,
  type PublicBrand,
  type PublicMeetingType,
} from "./types";

export async function findActiveMeetingType(
  slug: string
): Promise<{ meetingType: MeetingTypeFull; host: Host } | null> {
  const row = await prisma.meetingType.findUnique({
    where: { slug },
    include: { ...meetingTypeInclude, host: true },
  });
  if (!row || !row.active) return null;
  const { host, ...meetingType } = row;
  return { meetingType, host };
}

export function questionsOf(mt: { questions: unknown }): BookingQuestion[] {
  return parseQuestions(mt.questions);
}

export function toPublicBrand(brand: Brand | null | undefined): PublicBrand | null {
  if (!brand) return null;
  return {
    slug: brand.slug,
    name: brand.name,
    tagline: brand.tagline,
    logoUrl: brand.logoUrl,
    accentColor: brand.accentColor,
    theme: brand.theme === "light" || brand.theme === "dark" ? brand.theme : "auto",
    websiteUrl: brand.websiteUrl,
    showPoweredBy: brand.showPoweredBy,
  };
}

export function toPublic(mt: MeetingTypeFull, host: Host): PublicMeetingType {
  return {
    slug: mt.slug,
    name: mt.name,
    description: mt.description,
    durationMinutes: mt.durationMinutes,
    durations: durationChoices(mt),
    priceCents: mt.priceCents,
    currency: mt.currency,
    color: mt.brand?.accentColor || mt.color,
    questions: questionsOf(mt),
    locations: parseLocations(mt.locations).map((l) =>
      // The invitee's number is theirs to enter; never leak host-only values for that kind.
      l.kind === "phone_invitee" ? { kind: l.kind, label: l.label ?? null } : l
    ),
    allowGuests: mt.allowGuests,
    maxGuests: mt.maxGuests,
    policyText: mt.policyText,
    cancelCutoffHours: mt.cancelCutoffHours,
    displayMode: mt.displayMode,
    hostName: host.displayName || host.email.split("@")[0],
    hostAvatarUrl: host.avatarUrl,
    hostTimezone: mt.schedule?.timezone || host.timezone,
    brand: toPublicBrand(mt.brand),
  };
}
