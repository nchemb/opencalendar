import Link from "next/link";
import { prisma } from "@/lib/db";
import { getHost } from "@/lib/booking";
import EventTypesList, { type EventTypeRow } from "./EventTypesList";

export const dynamic = "force-dynamic";

export default async function EventTypesPage() {
  const [host, rows] = await Promise.all([
    getHost(),
    prisma.meetingType.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { brand: true } }),
  ]);

  const types: EventTypeRow[] = rows.map((m) => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    durationMinutes: m.durationMinutes,
    priceCents: m.priceCents,
    color: m.color,
    active: m.active,
    secret: m.secret,
    brandName: m.brand?.name ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Event types</h1>
          <p className="text-[var(--bk-muted)] text-sm">Booking links. Drag order sets the profile page order.</p>
        </div>
        <Link href="/admin/event-types/new" className="bk-btn bk-btn-primary ml-auto" aria-disabled={!host}>
          New event type
        </Link>
      </div>

      {!host && (
        <p className="text-sm" style={{ color: "var(--bk-danger)" }}>
          Connect Google Calendar in Settings before creating event types.
        </p>
      )}

      <EventTypesList types={types} />
    </div>
  );
}
