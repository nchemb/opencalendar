import { adminSession } from "@/lib/auth";
import { createApiKey } from "@/lib/admin/api-keys";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { cleanString } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  const body = await readJson<Record<string, unknown>>(req);
  const name = cleanString(body?.name, 80) ?? "API key";
  try {
    const { id, plaintext } = await createApiKey(name);
    log.info("admin", "api_key_created", { id });
    // Shown exactly once, here.
    return ok({ id, key: plaintext });
  } catch (err) {
    log.error("admin", "api_key_create_failed", { error: errorMessage(err) });
    return fail("Could not create the key.", 500, "FAILED");
  }
}
