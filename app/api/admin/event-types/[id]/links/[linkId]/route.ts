import { adminSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string; linkId: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  try {
    await prisma.singleUseLink.delete({ where: { id: params.linkId } });
    return ok({ deleted: true });
  } catch (err) {
    log.error("admin", "single_use_link_delete_failed", { error: errorMessage(err) });
    return fail("Could not delete.", 500, "FAILED");
  }
}
