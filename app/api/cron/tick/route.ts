import { cronAuthorized, tick } from "@/lib/cron";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET|POST /api/cron/tick — Authorization: Bearer $CRON_SECRET (Vercel Cron sends it).
 * Drains the outbox, releases stale holds, pulls missed payments, and every 30 min
 * runs the availability canary and calendar reconcile. `?force=1` runs everything now.
 */
async function handle(req: Request) {
  if (!cronAuthorized(req)) return fail("Unauthorized.", 401, "UNAUTHORIZED");
  const force = new URL(req.url).searchParams.get("force") === "1";
  const result = await tick({ budgetMs: 45_000, force });
  return ok({ result });
}

export const GET = handle;
export const POST = handle;
