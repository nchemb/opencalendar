import { resetDemoData } from "@/lib/demo";
import { isDemoMode } from "@/lib/env";
import { env } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/demo/reset — clears the demo instance's bookings and restores its
 * meeting types. Driven by the daily cron in vercel.json.
 *
 * Refuses unless the instance is actually in demo mode, so a stray call to a
 * real deployment can never delete someone's bookings.
 */
export async function POST(req: Request) {
  if (!isDemoMode()) {
    return fail("This instance is not a demo.", 404, "NOT_DEMO");
  }

  const secret = env("DEMO_RESET_SECRET");
  if (!secret) {
    return fail("DEMO_RESET_SECRET is not configured.", 503, "NO_SECRET");
  }

  // Vercel Cron sends its own bearer token; a manual call can use the header.
  const authorized =
    req.headers.get("x-bookkit-demo-secret") === secret ||
    req.headers.get("authorization") === `Bearer ${secret}`;

  if (!authorized) {
    log.warn("demo", "reset_unauthorized");
    return fail("Not authorized.", 401, "UNAUTHORIZED");
  }

  try {
    const result = await resetDemoData();
    log.info("demo", "reset_ok", result);
    return ok(result);
  } catch (err) {
    log.error("demo", "reset_failed", { error: errorMessage(err) });
    return fail("Reset failed.", 500, "RESET_FAILED");
  }
}
