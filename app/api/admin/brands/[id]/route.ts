import { adminSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { ValidationError, parseBrandInput } from "@/lib/meeting-type-input";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail("Invalid request body.", 400, "BAD_BODY");
  try {
    const fields = parseBrandInput(body);
    const updated = await prisma.brand.update({ where: { id: params.id }, data: fields });
    log.info("admin", "brand_updated", { slug: updated.slug });
    return ok({ id: updated.id, slug: updated.slug });
  } catch (err) {
    if (err instanceof ValidationError) return fail(err.message, 400, "VALIDATION");
    if ((err as { code?: string })?.code === "P2002") return fail("That slug is already taken.", 409, "SLUG_TAKEN");
    if ((err as { code?: string })?.code === "P2025") return fail("Brand not found.", 404, "NOT_FOUND");
    log.error("admin", "brand_update_failed", { error: errorMessage(err) });
    return fail("Could not save the brand.", 500, "FAILED");
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  try {
    await prisma.meetingType.updateMany({ where: { brandId: params.id }, data: { brandId: null } });
    await prisma.brand.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (err) {
    log.error("admin", "brand_delete_failed", { error: errorMessage(err) });
    return fail("Could not delete the brand.", 500, "FAILED");
  }
}
