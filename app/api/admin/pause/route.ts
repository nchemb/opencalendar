import { adminSession } from "@/lib/auth";
import { requireHost } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { ValidationError, parsePauseInput } from "@/lib/meeting-type-input";

export const dynamic = "force-dynamic";

/** POST /api/admin/pause — { paused, pausedUntil?, pausedMessage? } */
export async function POST(req: Request) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail("Invalid request body.", 400, "BAD_BODY");
  try {
    const fields = parsePauseInput(body);
    const host = await requireHost();
    await prisma.host.update({ where: { id: host.id }, data: fields });
    log.info("admin", "pause_updated", { paused: fields.paused });
    return ok({ saved: true });
  } catch (err) {
    if (err instanceof ValidationError) return fail(err.message, 400, "VALIDATION");
    log.error("admin", "pause_failed", { error: errorMessage(err) });
    return fail("Could not save.", 500, "FAILED");
  }
}
