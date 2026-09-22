import { adminSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { ValidationError, parseScheduleInput } from "@/lib/meeting-type-input";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail("Invalid request body.", 400, "BAD_BODY");
  try {
    const existing = await prisma.schedule.findUnique({ where: { id: params.id } });
    if (!existing) return fail("Schedule not found.", 404, "NOT_FOUND");
    const fields = parseScheduleInput(body);
    if (fields.isDefault) {
      await prisma.schedule.updateMany({ where: { hostId: existing.hostId, isDefault: true, id: { not: params.id } }, data: { isDefault: false } });
    }
    const updated = await prisma.schedule.update({ where: { id: params.id }, data: fields });
    log.info("admin", "schedule_updated", { name: updated.name });
    return ok({ id: updated.id });
  } catch (err) {
    if (err instanceof ValidationError) return fail(err.message, 400, "VALIDATION");
    if ((err as { code?: string })?.code === "P2025") return fail("Schedule not found.", 404, "NOT_FOUND");
    log.error("admin", "schedule_update_failed", { error: errorMessage(err) });
    return fail("Could not save the schedule.", 500, "FAILED");
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  try {
    // Event types using this schedule fall back to the host timezone (scheduleId is optional).
    await prisma.meetingType.updateMany({ where: { scheduleId: params.id }, data: { scheduleId: null } });
    await prisma.schedule.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (err) {
    log.error("admin", "schedule_delete_failed", { error: errorMessage(err) });
    return fail("Could not delete the schedule.", 500, "FAILED");
  }
}
