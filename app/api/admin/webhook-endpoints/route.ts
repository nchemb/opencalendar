import { adminSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { ValidationError, parseWebhookEndpointInput } from "@/lib/meeting-type-input";
import { newWebhookSecret, WEBHOOK_EVENTS } from "@/lib/webhooks";
import { assertPublicUrl, BlockedUrlError } from "@/lib/net-guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail("Invalid request body.", 400, "BAD_BODY");
  try {
    const fields = parseWebhookEndpointInput(body, WEBHOOK_EVENTS);
    try {
      await assertPublicUrl(fields.url);
    } catch (err) {
      if (err instanceof BlockedUrlError) return fail(err.message, 400, "VALIDATION");
      throw err;
    }
    const secret = newWebhookSecret();
    const created = await prisma.webhookEndpoint.create({ data: { ...fields, secret } });
    log.info("admin", "webhook_endpoint_created", { id: created.id });
    // Secret is shown exactly once, here.
    return ok({ id: created.id, secret });
  } catch (err) {
    if (err instanceof ValidationError) return fail(err.message, 400, "VALIDATION");
    log.error("admin", "webhook_endpoint_create_failed", { error: errorMessage(err) });
    return fail("Could not create the endpoint.", 500, "FAILED");
  }
}
