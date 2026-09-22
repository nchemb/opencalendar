import Link from "next/link";
import { bookingsBySource, cancellationStats, funnelByType, revenueSummary } from "@/lib/admin/analytics";
import { formatPrice } from "@/lib/stripe";

export const dynamic = "force-dynamic";

const WINDOWS = [7, 30, 90];

export default async function AnalyticsPage({ searchParams }: { searchParams: { days?: string } }) {
  const days = WINDOWS.includes(Number(searchParams.days)) ? Number(searchParams.days) : 30;

  const [funnel, sources, revenue, cancellations] = await Promise.all([
    funnelByType(days),
    bookingsBySource(days),
    revenueSummary(days),
    cancellationStats(days),
  ]);

  const maxSource = Math.max(1, ...sources.map((s) => s.count));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <div className="bk-tabs ml-auto !border-b-0">
          {WINDOWS.map((w) => (
            <Link key={w} href={`/admin/analytics?days=${w}`} className={`bk-tab ${days === w ? "bk-tab-active" : ""}`}>
              {w}d
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Collected" value={formatPrice(revenue.collectedCents)} />
        <Stat label="Refunded" value={formatPrice(revenue.refundedCents)} />
        <Stat label="Cancellations" value={String(cancellations.cancelled)} />
        <Stat label="No-shows" value={String(cancellations.noShow)} />
      </div>

      <section>
        <h2 className="font-semibold mb-3">Funnel by event type</h2>
        {funnel.length === 0 ? (
          <p className="text-sm text-[var(--bk-muted)]">No analytics recorded yet in this window.</p>
        ) : (
          <div className="bk-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--bk-muted)] border-b border-[var(--bk-border)]">
                  <th className="p-3 font-medium">Type</th>
                  <th className="p-3 font-medium">Views</th>
                  <th className="p-3 font-medium">Slot picked</th>
                  <th className="p-3 font-medium">Booked</th>
                  <th className="p-3 font-medium">Conversion</th>
                  <th className="p-3 font-medium">Cancelled</th>
                  <th className="p-3 font-medium">No-show</th>
                </tr>
              </thead>
              <tbody>
                {funnel.map((f) => (
                  <tr key={f.meetingTypeId} className="border-b border-[var(--bk-border)] last:border-0">
                    <td className="p-3 font-medium">{f.meetingTypeName}</td>
                    <td className="p-3">{f.views}</td>
                    <td className="p-3">{f.slots}</td>
                    <td className="p-3">{f.booked}</td>
                    <td className="p-3">{f.conversionPct}%</td>
                    <td className="p-3">{f.cancelled}</td>
                    <td className="p-3">{f.noShow}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-3">Bookings by source</h2>
        {sources.length === 0 ? (
          <p className="text-sm text-[var(--bk-muted)]">No source data yet.</p>
        ) : (
          <div className="space-y-2">
            {sources.map((s) => (
              <div key={s.source} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 truncate">{s.source}</span>
                <div className="bk-bar-track flex-1">
                  <div className="bk-bar-fill" style={{ width: `${(s.count / maxSource) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </section>
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
