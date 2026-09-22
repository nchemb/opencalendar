import { findByManageToken } from "@/lib/booking";
import { calendarItem } from "@/lib/emails";
import { buildIcs } from "@/lib/ics";

export const dynamic = "force-dynamic";

/** GET /api/bookings/ics/<manage token> — the booking as an .ics file. */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const row = await findByManageToken(params.token);
  if (!row) return new Response("Not found", { status: 404 });
  const { meetingType, host, ...booking } = row;
  return new Response(buildIcs(calendarItem({ booking, meetingType, host })), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${meetingType.slug}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
