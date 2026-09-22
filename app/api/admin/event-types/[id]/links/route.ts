import { adminSession } from "@/lib/auth";
import { createSingleUseLink } from "@/lib/admin/single-use-links";
import { prisma } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/logger";
import { ValidationError } from "@/lib/meeting-type-input";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  const links = await prisma.singleUseLink.findMany({ where: { meetingTypeId: params.id }, orderBy: { createdAt: "desc" } });
  return ok({
    links: links.map((l) => ({
      id: l.id,
      token: l.token,
      label: l.label,
      durationMinutes: l.durationMinutes,
      priceCents: l.priceCents,
      expiresAt: l.expiresAt?.toISOString() ?? null,
      usedAt: l.usedAt?.toISOString() ?? null,
    })),
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail("Invalid request body.", 400, "BAD_BODY");
  try {
    const link = await createSingleUseLink(params.id, body);
    return ok({ id: link.id, token: link.token });
  } catch (err) {
    if (err instanceof ValidationError) return fail(err.message, 400, "VALIDATION");
    log.error("admin", "single_use_link_create_failed", { error: errorMessage(err) });
    return fail("Could not create link.", 500, "FAILED");
  }
}
