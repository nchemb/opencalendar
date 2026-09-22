import { requireHost } from "@/lib/booking";
import { apiFail, apiOk, corsPreflight, requireApiKey } from "@/lib/api-auth";
import { meetingTypeInclude, type MeetingTypeFull } from "@/lib/availability";
import { toPublic } from "@/lib/meeting-types";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/** GET /api/v1/event-types — every active event type, including secret ones (API keys see everything). */
export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if ("response" in auth) return auth.response;
  if (!rateLimit(`v1:${auth.key.id}`, { limit: 300, windowMs: 60_000 }).allowed) {
    return apiFail("Too many requests.", 429, "RATE_LIMITED");
  }

  const host = await requireHost();
  const rows = await prisma.meetingType.findMany({
    where: { hostId: host.id, active: true },
    include: meetingTypeInclude,
    orderBy: { position: "asc" },
  });

  return apiOk({
    eventTypes: (rows as MeetingTypeFull[]).map((mt) => ({ ...toPublic(mt, host), secret: mt.secret })),
  });
}
