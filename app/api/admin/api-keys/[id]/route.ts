import { adminSession } from "@/lib/auth";
import { revokeApiKey } from "@/lib/admin/api-keys";
import { fail, ok } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  try {
    await revokeApiKey(params.id);
    return ok({ revoked: true });
  } catch (err) {
    log.error("admin", "api_key_revoke_failed", { error: errorMessage(err) });
    return fail("Could not revoke.", 500, "FAILED");
  }
}
