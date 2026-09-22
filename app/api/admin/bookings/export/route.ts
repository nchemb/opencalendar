import { adminSession } from "@/lib/auth";
import { getHost } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { bookingsToCsv } from "@/lib/admin/csv";

export const dynamic = "force-dynamic";

/** GET /api/admin/bookings/export — CSV of every booking. */
export async function GET() {
  if (!(await adminSession())) return new Response("Not authorized.", { status: 401 });
  const host = await getHost();
  const rows = await prisma.booking.findMany({
    orderBy: { startTime: "desc" },
    take: 10_000,
    include: { meetingType: { select: { name: true } } },
  });
  const csv = bookingsToCsv(rows, host?.timezone ?? "UTC");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bookkit-bookings-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
