/**
 * "Needs attention" = a booking a host must look at: a failed slot conflict, a
 * confirmed booking whose calendar write never landed, or a booking with a dead
 * or overdue outbox job. Used by the bookings tab and the overview count.
 */
import { prisma } from "../db";

export function needsAttentionWhere() {
  return {
    OR: [
      { status: "FAILED_NEEDS_INTERVENTION" as const },
      { status: "CONFIRMED" as const, googleEventId: null },
    ],
  };
}

export async function needsAttentionBookingIds(): Promise<Set<string>> {
  const [flagged, jobRows] = await Promise.all([
    prisma.booking.findMany({ where: needsAttentionWhere(), select: { id: true } }),
    prisma.job.findMany({
      where: {
        bookingId: { not: null },
        doneAt: null,
        OR: [{ deadAt: { not: null } }, { runAt: { lte: new Date(Date.now() - 15 * 60_000) } }],
      },
      select: { bookingId: true },
    }),
  ]);
  const ids = new Set<string>();
  for (const b of flagged) ids.add(b.id);
  for (const j of jobRows) if (j.bookingId) ids.add(j.bookingId);
  return ids;
}

export async function needsAttentionCount(): Promise<number> {
  return (await needsAttentionBookingIds()).size;
}
