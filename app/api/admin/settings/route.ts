import { isAdmin } from "@/lib/auth";
import { getHost } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { ValidationError, parseHostInput } from "@/lib/meeting-type-input";
import { setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** POST /api/admin/settings — outbound webhook config + host profile. */
export async function POST(req: Request) {
  if (!isAdmin()) return fail("Not authorized.", 401, "UNAUTHORIZED");

  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail("Invalid request body.", 400, "BAD_BODY");

  try {
    if (typeof body.webhookUrl === "string") {
      const url = body.webhookUrl.trim();
      if (url) {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
          return fail("Webhook URL must use https.", 400, "VALIDATION");
        }
      }
      await setSetting("WEBHOOK_URL", url);
    }
    if (typeof body.webhookSecret === "string") {
      await setSetting("WEBHOOK_SECRET", body.webhookSecret.trim());
    }

    if (body.timezone !== undefined) {
      const host = await getHost();
      if (!host) return fail("Connect Google Calendar first.", 400, "NO_HOST");
      const fields = parseHostInput(body);
      await prisma.host.update({ where: { id: host.id }, data: fields });
    }

    log.info("admin", "settings_saved");
    return ok({ saved: true });
  } catch (err) {
    if (err instanceof ValidationError) return fail(err.message, 400, "VALIDATION");
    if (err instanceof TypeError) return fail("Webhook URL is not a valid URL.", 400, "VALIDATION");
    log.error("admin", "settings_failed", { error: errorMessage(err) });
    return fail("Could not save settings.", 500, "FAILED");
  }
}
