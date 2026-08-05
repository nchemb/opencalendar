import { appUrl } from "@/lib/env";
import { prisma } from "@/lib/db";
import { getHost } from "@/lib/booking";
import { parseWeeklyHours } from "@/lib/types";
import { questionsOf } from "@/lib/meeting-types";
import MeetingTypeManager, { type EditableMeetingType } from "./MeetingTypeManager";

export const dynamic = "force-dynamic";

export default async function MeetingTypesPage() {
  const host = await getHost();
  const rows = await prisma.meetingType.findMany({ orderBy: { createdAt: "asc" } });

  const meetingTypes: EditableMeetingType[] = rows.map((m) => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    description: m.description ?? "",
    durationMinutes: m.durationMinutes,
    priceCents: m.priceCents,
    currency: m.currency,
    color: m.color,
    weeklyHours: parseWeeklyHours(m.weeklyHours),
    daysInAdvance: m.daysInAdvance,
    minNoticeHours: m.minNoticeHours,
    bufferMinutes: m.bufferMinutes,
    dailyLimit: m.dailyLimit,
    questions: questionsOf(m),
    redirectUrl: m.redirectUrl ?? "",
    displayMode: m.displayMode,
    active: m.active,
  }));

  return (
    <MeetingTypeManager
      meetingTypes={meetingTypes}
      baseUrl={appUrl()}
      hostReady={Boolean(host)}
      hostTimezone={host?.timezone ?? "UTC"}
    />
  );
}
