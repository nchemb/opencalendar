import { adminSession } from "@/lib/auth";
import { deleteDataForEmail, exportDataForEmail } from "@/lib/admin/privacy";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { isEmail } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** POST /api/admin/privacy — { action: "export" | "delete", email } */
export async function POST(req: Request) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  const body = await readJson<Record<string, unknown>>(req);
  const email = body?.email;
  if (!isEmail(email)) return fail("A valid email is required.", 400, "VALIDATION");

  try {
    if (body?.action === "export") return ok(await exportDataForEmail(email));
    if (body?.action === "delete") return ok(await deleteDataForEmail(email));
    return fail("Unknown action.", 400, "BAD_ACTION");
  } catch (err) {
    log.error("admin", "privacy_action_failed", { error: errorMessage(err) });
    return fail("Action failed.", 500, "FAILED");
  }
}
