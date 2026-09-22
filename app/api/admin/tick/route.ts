import { adminSession } from "@/lib/auth";
import { tick } from "@/lib/cron";
import { fail, ok } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** POST /api/admin/tick — "Run checks now" on the overview page. Forces canary + reconcile. */
export async function POST() {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  try {
    const result = await tick({ force: true, budgetMs: 15_000 });
    return ok({ result });
  } catch (err) {
    log.error("admin", "manual_tick_failed", { error: errorMessage(err) });
    return fail("Tick failed.", 500, "FAILED");
  }
}
