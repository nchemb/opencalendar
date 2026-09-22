import { prisma } from "@/lib/db";
import { parseOverrides, parseWeeklyHours } from "@/lib/types";
import { getHost } from "@/lib/booking";
import SchedulesManager, { type EditableSchedule } from "./SchedulesManager";
import Troubleshooter from "./Troubleshooter";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage() {
  const [host, rows, types] = await Promise.all([
    getHost(),
    prisma.schedule.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.meetingType.findMany({ select: { id: true, name: true, slug: true }, orderBy: { position: "asc" } }),
  ]);

  const schedules: EditableSchedule[] = rows.map((s) => ({
    id: s.id,
    name: s.name,
    timezone: s.timezone,
    weeklyHours: parseWeeklyHours(s.weeklyHours),
    overrides: parseOverrides(s.overrides),
    isDefault: s.isDefault,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Availability</h1>
        <p className="text-[var(--bk-muted)] text-sm">Host timezone: {host?.timezone ?? "not set"}.</p>
      </div>

      <SchedulesManager schedules={schedules} />

      <section>
        <h2 className="font-semibold mb-1">Troubleshooter</h2>
        <p className="text-[var(--bk-muted)] text-sm mb-3">Why is this time unavailable? Pick an event type and a date.</p>
        <Troubleshooter types={types} />
      </section>
    </div>
  );
}
