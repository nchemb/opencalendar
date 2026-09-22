import { adminSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  const body = await readJson<Record<string, unknown>>(req);
  try {
    await prisma.webhookEndpoint.update({ where: { id: params.id }, data: { active: body?.active !== false } });
    return ok({ saved: true });
  } catch (err) {
    log.error("admin", "webhook_endpoint_update_failed", { error: errorMessage(err) });
    return fail("Could not save.", 500, "FAILED");
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  try {
    await prisma.webhookEndpoint.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (err) {
    log.error("admin", "webhook_endpoint_delete_failed", { error: errorMessage(err) });
    return fail("Could not delete.", 500, "FAILED");
  }
}
