import Link from "next/link";
import { DateTime } from "luxon";
import { getHost } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { formatPrice } from "@/lib/stripe";
import { health, type Check } from "@/lib/health";
import { needsAttentionCount } from "@/lib/admin/needs-attention";
import RunChecksButton from "./RunChecksButton";
import PauseSwitch from "./PauseSwitch";

export const dynamic = "force-dynamic";

const CHECK_LABELS: Record<string, string> = {
  database: "Database",
  setup: "Setup",
  calendar: "Google Calendar",
  cron: "Cron",
  outbox: "Outbox (retries)",
  alerts: "Alerts",
  email: "Email",
  payments: "Payments",
};

function tone(c: Check): "ok" | "danger" {
  return c.ok ? "ok" : "danger";
}

export default async function AdminOverview() {
  const [host, h, needsAttention] = await Promise.all([getHost(), health(), needsAttentionCount()]);
  const now = new Date();
  const tz = host?.timezone ?? "UTC";
  const todayEnd = DateTime.now().setZone(tz).endOf("day").toJSDate();

  const [today, upcoming, confirmedCount, revenue] = await Promise.all([
    prisma.booking.findMany({
      where: { status: "CONFIRMED", startTime: { gte: now, lte: todayEnd } },
      orderBy: { startTime: "asc" },
      include: { meetingType: { select: { name: true, color: true } } },
    }),
    prisma.booking.findMany({
      where: { status: "CONFIRMED", startTime: { gt: todayEnd } },
      orderBy: { startTime: "asc" },
      take: 8,
      include: { meetingType: { select: { name: true, color: true } } },
    }),
    prisma.booking.count({ where: { status: "CONFIRMED" } }),
    prisma.booking.aggregate({ _sum: { amountCents: true }, where: { status: "CONFIRMED", stripePaymentStatus: "paid" } }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Overview</h1>
          <p className="text-[var(--bk-muted)] text-sm">All times shown in {tz}.</p>
        </div>
        <div className="ml-auto">
          <RunChecksButton />
        </div>
      </div>

      <section className="bk-card p-5">
        <h2 className="font-semibold mb-3">System health {h.ok ? "" : "— attention needed"}</h2>
        <ul className="space-y-2 text-sm">
          {Object.entries(h.checks).map(([key, c]) => (
            <li key={key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0 self-center"
                style={{ background: c.ok ? "var(--bk-ok)" : "var(--bk-danger)" }}
              />
              <span className="font-medium">{CHECK_LABELS[key] ?? key}</span>
              <span className="text-[var(--bk-muted)]">{c.detail}</span>
              {!c.ok && key === "calendar" && (
                <Link href="/admin/settings" className="text-xs underline">
                  Fix in Settings
                </Link>
              )}
              {!c.ok && (key === "outbox" || key === "alerts") && (
                <Link href="/admin/bookings?tab=attention" className="text-xs underline">
                  Review bookings
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      {needsAttention > 0 && (
        <Link
          href="/admin/bookings?tab=attention"
          className="bk-card p-4 flex items-center gap-3 block"
          style={{ borderColor: "var(--bk-danger)" }}
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--bk-danger)" }} />
          <span className="font-semibold" style={{ color: "var(--bk-danger)" }}>
            {needsAttention} booking{needsAttention > 1 ? "s" : ""} need manual attention
          </span>
          <span className="text-sm text-[var(--bk-muted)] ml-auto">Review →</span>
        </Link>
      )}

      <PauseSwitch paused={host?.paused ?? false} pausedMessage={host?.pausedMessage ?? ""} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Today" value={String(today.length)} />
        <Stat label="Upcoming" value={String(upcoming.length)} />
        <Stat label="Confirmed all time" value={String(confirmedCount)} />
        <Stat label="Collected" value={formatPrice(revenue._sum.amountCents ?? 0)} />
      </div>

      <BookingList title="Today" rows={today} tz={tz} empty="Nothing today." />
      <BookingList title="Upcoming" rows={upcoming} tz={tz} empty="Nothing else on the books yet." />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bk-card p-4">
      <p className="text-xs uppercase tracking-wider text-[var(--bk-muted)] mb-1">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

function BookingList({
  title,
  rows,
  tz,
  empty,
}: {
  title: string;
  rows: { id: string; startTime: Date; name: string; email: string; meetLink: string | null; meetingType: { name: string; color: string } }[];
  tz: string;
  empty: string;
}) {
  return (
    <div>
      <h2 className="font-semibold mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-[var(--bk-muted)] text-sm">{empty}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((b) => {
            const start = DateTime.fromJSDate(b.startTime, { zone: tz });
            return (
              <Link key={b.id} href={`/admin/bookings/${b.id}`} className="bk-card p-4 flex flex-wrap items-center gap-x-4 gap-y-1 block">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: b.meetingType.color }} />
                <span className="font-medium">{start.toFormat("ccc LLL d, h:mm a")}</span>
                <span className="text-sm text-[var(--bk-muted)]">{b.meetingType.name}</span>
                <span className="text-sm">{b.name}</span>
                <span className="text-sm text-[var(--bk-muted)]">{b.email}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
