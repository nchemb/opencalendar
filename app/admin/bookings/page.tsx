import Link from "next/link";
import { getHost } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { needsAttentionBookingIds, needsAttentionWhere } from "@/lib/admin/needs-attention";
import BookingsTable, { type AdminBooking } from "./BookingsTable";

export const dynamic = "force-dynamic";

type Tab = "upcoming" | "past" | "cancelled" | "attention";
const TABS: { key: Tab; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "cancelled", label: "Cancelled" },
  { key: "attention", label: "Needs attention" },
];

export default async function BookingsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const host = await getHost();
  const tab: Tab = (["upcoming", "past", "cancelled", "attention"] as const).includes(searchParams.tab as Tab)
    ? (searchParams.tab as Tab)
    : "upcoming";
  const now = new Date();

  let rows;
  let attentionIds: Set<string> | null = null;
  if (tab === "attention") {
    attentionIds = await needsAttentionBookingIds();
    rows = await prisma.booking.findMany({
      where: { OR: [needsAttentionWhere(), { id: { in: [...attentionIds] } }] },
      orderBy: { startTime: "desc" },
      take: 300,
      include: { meetingType: { select: { name: true, color: true, slug: true } } },
    });
  } else if (tab === "cancelled") {
    rows = await prisma.booking.findMany({
      where: { status: "CANCELLED" },
      orderBy: { startTime: "desc" },
      take: 300,
      include: { meetingType: { select: { name: true, color: true, slug: true } } },
    });
  } else if (tab === "past") {
    rows = await prisma.booking.findMany({
      where: { startTime: { lt: now }, status: { in: ["CONFIRMED", "EXPIRED"] } },
      orderBy: { startTime: "desc" },
      take: 300,
      include: { meetingType: { select: { name: true, color: true, slug: true } } },
    });
  } else {
    rows = await prisma.booking.findMany({
      where: { startTime: { gte: now }, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } },
      orderBy: { startTime: "asc" },
      take: 300,
      include: { meetingType: { select: { name: true, color: true, slug: true } } },
    });
  }

  const bookings: AdminBooking[] = rows.map((b) => ({
    id: b.id,
    name: b.name,
    email: b.email,
    status: b.status,
    startTime: b.startTime.toISOString(),
    endTime: b.endTime.toISOString(),
    bookerTimezone: b.timezone,
    meetLink: b.meetLink,
    amountCents: b.amountCents,
    paymentStatus: b.stripePaymentStatus,
    customAnswer: b.customAnswer,
    syncError: b.googleSyncError,
    noShow: b.noShow,
    needsAttention: attentionIds ? attentionIds.has(b.id) : false,
    createdAt: b.createdAt.toISOString(),
    meetingType: b.meetingType,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Bookings</h1>
          <p className="text-[var(--bk-muted)] text-sm">Times shown in {host?.timezone ?? "UTC"}.</p>
        </div>
        <a href="/api/admin/bookings/export" className="bk-btn bk-btn-ghost ml-auto !py-1.5 !px-3 !text-sm">
          Export CSV
        </a>
      </div>

      <div className="bk-tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/bookings?tab=${t.key}`} className={`bk-tab ${tab === t.key ? "bk-tab-active" : ""}`}>
            {t.label}
          </Link>
        ))}
      </div>

      <BookingsTable bookings={bookings} hostTimezone={host?.timezone ?? "UTC"} />
    </div>
  );
}
