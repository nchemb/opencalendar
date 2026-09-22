import { bumpMetric } from "@/lib/analytics";
import { clientIp, fail, ok, readJson } from "@/lib/http";
import { findActiveMeetingType } from "@/lib/meeting-types";
import { rateLimit } from "@/lib/rate-limit";
import { isSlug } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** POST /api/analytics/slot — bumps the "slot selected" funnel counter. Slug only, no PII. */
export async function POST(req: Request) {
  if (!rateLimit(`analytics-slot:${clientIp(req)}`, { limit: 60, windowMs: 60_000 }).allowed) {
    return fail("Too many requests.", 429, "RATE_LIMITED");
  }
  const body = await readJson<Record<string, unknown>>(req);
  if (!body || !isSlug(body.slug)) return fail("Invalid meeting type.", 400, "BAD_SLUG");
  const found = await findActiveMeetingType(body.slug);
  if (found) await bumpMetric(found.meetingType.id, "slot", "");
  return ok({});
}
