import { adminSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";

export const dynamic = "force-dynamic";

function uniqueSlug(base: string): string {
  return `${base}-copy-${Math.random().toString(36).slice(2, 6)}`;
}

/** POST /api/admin/event-types/[id]/duplicate */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  try {
    const src = await prisma.meetingType.findUnique({ where: { id: params.id } });
    if (!src) return fail("Event type not found.", 404, "NOT_FOUND");

    const rest: Record<string, unknown> = { ...(src as unknown as Record<string, unknown>) };
    for (const k of ["id", "slug", "createdAt", "updatedAt", "bookings", "singleUseLinks"]) delete rest[k];
    const count = await prisma.meetingType.count({ where: { hostId: src.hostId } });
    const created = await prisma.meetingType.create({
      data: { ...rest, slug: uniqueSlug(src.slug), name: `${src.name} (copy)`, active: false, position: count } as never,
    });
    log.info("admin", "event_type_duplicated", { from: src.slug, to: created.slug });
    return ok({ id: created.id, slug: created.slug });
  } catch (err) {
    log.error("admin", "event_type_duplicate_failed", { error: errorMessage(err) });
    return fail("Could not duplicate.", 500, "FAILED");
  }
}
