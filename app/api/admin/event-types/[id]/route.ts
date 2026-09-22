import { Prisma } from "@prisma/client";
import { adminSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { ValidationError, parseMeetingTypeInput } from "@/lib/meeting-type-input";

export const dynamic = "force-dynamic";

/**
 * PATCH accepts either a full editor save or a partial patch (e.g. { position }
 * from drag-reorder, { active } from the list toggle) — merged onto the existing
 * row and re-validated, so a partial patch can never leave other fields blank.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");

  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail("Invalid request body.", 400, "BAD_BODY");

  try {
    const existing = await prisma.meetingType.findUnique({ where: { id: params.id } });
    if (!existing) return fail("Event type not found.", 404, "NOT_FOUND");

    const merged = { ...existing, ...body } as Record<string, unknown>;
    const fields = parseMeetingTypeInput(merged);
    const position = Number.isInteger(body.position) ? Math.max(0, body.position as number) : undefined;

    const updated = await prisma.meetingType.update({
      where: { id: params.id },
      data: {
        ...fields,
        durationOptions: fields.durationOptions ?? Prisma.DbNull,
        ...(position !== undefined ? { position } : {}),
      },
    });
    log.info("admin", "event_type_updated", { slug: updated.slug });
    return ok({ id: updated.id, slug: updated.slug });
  } catch (err) {
    if (err instanceof ValidationError) return fail(err.message, 400, "VALIDATION");
    if ((err as { code?: string })?.code === "P2002") return fail("That slug is already taken.", 409, "SLUG_TAKEN");
    if ((err as { code?: string })?.code === "P2025") return fail("Event type not found.", 404, "NOT_FOUND");
    log.error("admin", "event_type_update_failed", { error: errorMessage(err) });
    return fail("Could not save the event type.", 500, "FAILED");
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");

  const live = await prisma.booking.count({
    where: { meetingTypeId: params.id, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } },
  });
  if (live > 0) {
    await prisma.meetingType.update({ where: { id: params.id }, data: { active: false } });
    return ok({ deactivated: true, reason: "It has live bookings, so it was deactivated instead." });
  }

  try {
    await prisma.meetingType.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2003") {
      await prisma.meetingType.update({ where: { id: params.id }, data: { active: false } });
      return ok({ deactivated: true, reason: "It has past bookings, so it was deactivated instead." });
    }
    log.error("admin", "event_type_delete_failed", { error: errorMessage(err) });
    return fail("Could not delete the event type.", 500, "FAILED");
  }
}
