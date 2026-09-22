import { adminSession } from "@/lib/auth";
import { explainDay, meetingTypeInclude } from "@/lib/availability";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** GET /api/admin/availability/explain?meetingTypeId=...&date=yyyy-MM-dd */
export async function GET(req: Request) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  const params = new URL(req.url).searchParams;
  const meetingTypeId = params.get("meetingTypeId");
  const date = params.get("date");
  if (!meetingTypeId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return fail("meetingTypeId and date=yyyy-MM-dd are required.", 400, "VALIDATION");
  }

  const mt = await prisma.meetingType.findUnique({ where: { id: meetingTypeId }, include: { ...meetingTypeInclude, host: true } });
  if (!mt) return fail("Event type not found.", 404, "NOT_FOUND");

  try {
    const slots = await explainDay(mt.host, mt, date);
    return ok({
      slots: slots.map((s) => ({
        start: s.start.toISOString(),
        reason: s.reason,
        busySource: s.busy?.calendarId ?? (s.busy?.source === "booking" ? "booking" : null),
      })),
    });
  } catch (err) {
    log.error("admin", "explain_day_failed", { error: errorMessage(err) });
    return fail("Could not read the calendar.", 502, "CALENDAR_ERROR");
  }
}
