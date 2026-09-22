import { adminSession } from "@/lib/auth";
import { requireHost } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { ValidationError, parseMeetingTypeInput } from "@/lib/meeting-type-input";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");

  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail("Invalid request body.", 400, "BAD_BODY");

  try {
    const fields = parseMeetingTypeInput(body);
    const host = await requireHost();

    const created = await prisma.meetingType.create({
      data: { ...fields, hostId: host.id },
    });

    log.info("admin", "meeting_type_created", { slug: created.slug });
    return ok({ meetingType: { id: created.id, slug: created.slug } });
  } catch (err) {
    if (err instanceof ValidationError) return fail(err.message, 400, "VALIDATION");
    if ((err as { code?: string })?.code === "P2002") {
      return fail("That slug is already taken.", 409, "SLUG_TAKEN");
    }
    log.error("admin", "meeting_type_create_failed", { error: errorMessage(err) });
    return fail("Could not create the meeting type.", 500, "FAILED");
  }
}
