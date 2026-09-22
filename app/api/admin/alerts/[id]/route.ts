import { adminSession } from "@/lib/auth";
import { resolveAlertById } from "@/lib/alerts";
import { fail, ok } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** POST /api/admin/alerts/[id] — resolve one open alert. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  try {
    await resolveAlertById(params.id);
    return ok({ resolved: true });
  } catch (err) {
    log.error("admin", "resolve_alert_failed", { id: params.id, error: errorMessage(err) });
    return fail("Could not resolve that alert.", 500, "FAILED");
  }
}
