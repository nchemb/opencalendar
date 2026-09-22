import { prisma } from "../db";

export type FunnelRow = {
  meetingTypeId: string;
  meetingTypeName: string;
  views: number;
  slots: number;
  booked: number;
  cancelled: number;
  noShow: number;
  conversionPct: number; // booked / views
};

function sinceDay(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export async function funnelByType(days: number): Promise<FunnelRow[]> {
  const since = sinceDay(days);
  const [rows, types] = await Promise.all([
    prisma.analyticsDaily.findMany({ where: { day: { gte: since } } }),
    prisma.meetingType.findMany({ select: { id: true, name: true } }),
  ]);
  const nameOf = new Map(types.map((t) => [t.id, t.name]));
  const byType = new Map<string, FunnelRow>();
  for (const r of rows) {
    const row = byType.get(r.meetingTypeId) ?? {
      meetingTypeId: r.meetingTypeId,
      meetingTypeName: nameOf.get(r.meetingTypeId) ?? "(deleted)",
      views: 0,
      slots: 0,
      booked: 0,
      cancelled: 0,
      noShow: 0,
      conversionPct: 0,
    };
    if (r.metric === "view") row.views += r.count;
    else if (r.metric === "slot") row.slots += r.count;
    else if (r.metric === "booked") row.booked += r.count;
    else if (r.metric === "cancelled") row.cancelled += r.count;
    else if (r.metric === "no_show") row.noShow += r.count;
    byType.set(r.meetingTypeId, row);
  }
  for (const row of byType.values()) row.conversionPct = row.views ? Math.round((row.booked / row.views) * 1000) / 10 : 0;
  return [...byType.values()].sort((a, b) => b.booked - a.booked);
}

export async function bookingsBySource(days: number): Promise<{ source: string; count: number }[]> {
  const since = sinceDay(days);
  const rows = await prisma.analyticsDaily.findMany({ where: { day: { gte: since }, metric: "booked" } });
  const bySource = new Map<string, number>();
  for (const r of rows) {
    const key = r.source || "(direct)";
    bySource.set(key, (bySource.get(key) ?? 0) + r.count);
  }
  return [...bySource.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
}

export async function revenueSummary(days: number): Promise<{ collectedCents: number; refundedCents: number; count: number }> {
  const since = new Date(Date.now() - days * 86_400_000);
  const paid = await prisma.booking.findMany({
    where: { createdAt: { gte: since }, stripePaymentStatus: { in: ["paid", "refunded"] } },
    select: { amountCents: true, stripePaymentStatus: true },
  });
  let collectedCents = 0;
  let refundedCents = 0;
  for (const b of paid) {
    const amt = b.amountCents ?? 0;
    if (b.stripePaymentStatus === "refunded") refundedCents += amt;
    else collectedCents += amt;
  }
  return { collectedCents, refundedCents, count: paid.length };
}

export async function cancellationStats(days: number): Promise<{ cancelled: number; noShow: number }> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [cancelled, noShow] = await Promise.all([
    prisma.booking.count({ where: { cancelledAt: { gte: since } } }),
    prisma.booking.count({ where: { noShow: true, startTime: { gte: since } } }),
  ]);
  return { cancelled, noShow };
}
