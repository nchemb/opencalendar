import { isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { ValidationError, parseMeetingTypeInput } from "@/lib/meeting-type-input";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!isAdmin()) return fail("Not authorized.", 401, "UNAUTHORIZED");

  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail("Invalid request body.", 400, "BAD_BODY");

  try {
    const fields = parseMeetingTypeInput(body);
    const updated = await prisma.meetingType.update({
      where: { id: params.id },
      data: fields,
    });
    log.info("admin", "meeting_type_updated", { slug: updated.slug });
    return ok({ meetingType: { id: updated.id, slug: updated.slug } });
  } catch (err) {
    if (err instanceof ValidationError) return fail(err.message, 400, "VALIDATION");
    if ((err as { code?: string })?.code === "P2002") {
      return fail("That slug is already taken.", 409, "SLUG_TAKEN");
    }
    if ((err as { code?: string })?.code === "P2025") {
      return fail("Meeting type not found.", 404, "NOT_FOUND");
    }
    log.error("admin", "meeting_type_update_failed", { error: errorMessage(err) });
    return fail("Could not save the meeting type.", 500, "FAILED");
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!isAdmin()) return fail("Not authorized.", 401, "UNAUTHORIZED");

  const live = await prisma.booking.count({
    where: { meetingTypeId: params.id, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } },
  });
  if (live > 0) {
    // Keep the history intact — deactivate instead of deleting.
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
    log.error("admin", "meeting_type_delete_failed", { error: errorMessage(err) });
    return fail("Could not delete the meeting type.", 500, "FAILED");
  }
}
