import { adminSession } from "@/lib/auth";
import { getHost } from "@/lib/booking";
import { raiseAlert } from "@/lib/alerts";
import { fail, ok } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** POST /api/admin/alerts/test — raises a dismissable info alert to prove alert channels work. */
export async function POST() {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  try {
    const host = await getHost();
    await raiseAlert(
      { kind: "test", severity: "info", title: "Test alert", message: "This is a test alert from BookKit admin settings.", key: `test:${Date.now()}` },
      host
    );
    return ok({ sent: true });
  } catch (err) {
    log.error("admin", "test_alert_failed", { error: errorMessage(err) });
    return fail("Could not send.", 500, "FAILED");
  }
}
