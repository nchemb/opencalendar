import { adminSession } from "@/lib/auth";
import { sendTestWebhook } from "@/lib/admin/webhook-test";
import { fail, ok } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  try {
    const result = await sendTestWebhook(params.id);
    return ok(result);
  } catch (err) {
    log.error("admin", "webhook_test_failed", { error: errorMessage(err) });
    return fail("Could not send the test delivery.", 500, "FAILED");
  }
}
