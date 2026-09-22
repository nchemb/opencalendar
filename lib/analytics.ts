import { prisma } from "./db";

export type Metric = "view" | "slot" | "booked" | "cancelled" | "no_show";

/**
 * Increment a daily funnel counter. Cookie-free and aggregate-only: nothing about
 * the visitor is stored beyond an optional utm_source bucket. Never throws.
 */
export async function bumpMetric(meetingTypeId: string, metric: Metric, source = ""): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const src = source.slice(0, 60).toLowerCase();
  await prisma.analyticsDaily
    .upsert({
      where: { day_meetingTypeId_metric_source: { day, meetingTypeId, metric, source: src } },
      create: { day, meetingTypeId, metric, source: src, count: 1 },
      update: { count: { increment: 1 } },
    })
    .catch(() => undefined);
}
