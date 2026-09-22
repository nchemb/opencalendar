import { adminSession } from "@/lib/auth";
import { requireHost } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { ValidationError, parseScheduleInput } from "@/lib/meeting-type-input";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail("Invalid request body.", 400, "BAD_BODY");
  try {
    const fields = parseScheduleInput(body);
    const host = await requireHost();
    if (fields.isDefault) await prisma.schedule.updateMany({ where: { hostId: host.id, isDefault: true }, data: { isDefault: false } });
    const created = await prisma.schedule.create({ data: { ...fields, hostId: host.id } });
    log.info("admin", "schedule_created", { name: created.name });
    return ok({ id: created.id });
  } catch (err) {
    if (err instanceof ValidationError) return fail(err.message, 400, "VALIDATION");
    log.error("admin", "schedule_create_failed", { error: errorMessage(err) });
    return fail("Could not create the schedule.", 500, "FAILED");
  }
}
