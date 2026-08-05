import Link from "next/link";
import { DateTime } from "luxon";
import { getHost } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { formatPrice, stripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const host = await getHost();
  const now = new Date();

  const [upcoming, failed, confirmedCount, revenue, meetingTypeCount] = await Promise.all([
    prisma.booking.findMany({
      where: { status: "CONFIRMED", startTime: { gte: now } },
      orderBy: { startTime: "asc" },
      take: 8,
      include: { meetingType: { select: { name: true, color: true } } },
    }),
    prisma.booking.findMany({
      where: { status: "FAILED_NEEDS_INTERVENTION" },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { meetingType: { select: { name: true } } },
    }),
    prisma.booking.count({ where: { status: "CONFIRMED" } }),
    prisma.booking.aggregate({
      _sum: { amountCents: true },
      where: { status: "CONFIRMED", stripePaymentStatus: "paid" },
    }),
    prisma.meetingType.count({ where: { active: true } }),
  ]);

  const tz = host?.timezone ?? "UTC";
  const googleOk = Boolean(host?.googleRefreshToken) && !host?.googleAuthError;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Overview</h1>
        <p className="text-[var(--bk-muted)] text-sm">
          All times shown in {tz}.
        </p>
      </div>

      {!googleOk && (
        <div className="bk-card p-5 border-[var(--bk-danger)]">
          <p className="font-semibold mb-1" style={{ color: "var(--bk-danger)" }}>
            Google Calendar is not connected
          </p>
          <p className="text-sm text-[var(--bk-muted)] mb-3">
            {host?.googleAuthError
              ? "The connection was rejected. Bookings are blocked until you reconnect."
              : "Bookings cannot be taken until you connect a calendar."}
          </p>
          <Link className="bk-btn bk-btn-primary" href="/admin/settings">
            Connect Google Calendar
          </Link>
        </div>
      )}

      {failed.length > 0 && (
        <div className="bk-card p-5" style={{ borderColor: "var(--bk-danger)" }}>
          <p className="font-semibold mb-3" style={{ color: "var(--bk-danger)" }}>
            {failed.length} booking{failed.length > 1 ? "s need" : " needs"} manual attention
          </p>
          <ul className="space-y-2 text-sm">
            {failed.map((b) => (
              <li key={b.id} className="flex flex-wrap gap-x-3 gap-y-1 items-baseline">
                <span className="font-medium">{b.name}</span>
                <span className="text-[var(--bk-muted)]">{b.email}</span>
                <span className="text-[var(--bk-muted)]">
                  {DateTime.fromJSDate(b.startTime, { zone: tz }).toFormat("LLL d, h:mm a")}
                </span>
                {b.stripePaymentStatus === "paid" && (
                  <span className="text-xs font-semibold" style={{ color: "var(--bk-danger)" }}>
                    PAID
                  </span>
                )}
              </li>
            ))}
          </ul>
          <Link className="bk-btn bk-btn-ghost mt-4" href="/admin/bookings?status=FAILED_NEEDS_INTERVENTION">
            Review and retry
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Upcoming" value={String(upcoming.length)} />
        <Stat label="Confirmed all time" value={String(confirmedCount)} />
        <Stat label="Collected" value={formatPrice(revenue._sum.amountCents ?? 0)} />
        <Stat label="Active types" value={String(meetingTypeCount)} />
      </div>

      <div>
        <h2 className="font-semibold mb-3">Next up</h2>
        {upcoming.length === 0 ? (
          <p className="text-[var(--bk-muted)] text-sm">Nothing on the books yet.</p>
        ) : (
          <div className="space-y-2">
            {upcoming.map((b) => {
              const start = DateTime.fromJSDate(b.startTime, { zone: tz });
              return (
                <div key={b.id} className="bk-card p-4 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: b.meetingType.color }}
                  />
                  <span className="font-medium">{start.toFormat("ccc LLL d, h:mm a")}</span>
                  <span className="text-sm text-[var(--bk-muted)]">{b.meetingType.name}</span>
                  <span className="text-sm">{b.name}</span>
                  <span className="text-sm text-[var(--bk-muted)]">{b.email}</span>
                  {b.meetLink && (
                    <a
                      href={b.meetLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm underline ml-auto"
                    >
                      Meet link
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!stripeConfigured() && (
        <p className="text-xs text-[var(--bk-muted)]">
          Stripe is not configured — paid meeting types will refuse checkout until STRIPE_SECRET_KEY is set.
        </p>
      )}
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
