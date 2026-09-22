import { adminSession } from "@/lib/auth";
import { drainJobs, retryJobNow } from "@/lib/jobs";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** POST /api/admin/jobs/[id]/retry — put a dead/waiting job at the front and drain it now. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  try {
    const job = await prisma.job.findUnique({ where: { id: params.id } });
    if (!job) return fail("Job not found.", 404, "NOT_FOUND");
    await retryJobNow(params.id);
    await drainJobs({ bookingId: job.bookingId ?? undefined, budgetMs: 5000 });
    return ok({ retried: true });
  } catch (err) {
    log.error("admin", "job_retry_failed", { id: params.id, error: errorMessage(err) });
    return fail("Retry failed.", 500, "FAILED");
  }
}
