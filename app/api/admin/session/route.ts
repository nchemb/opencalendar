import { adminSession, checkPassword, clearSessionCookie, issueSessionCookie, revokeAllSessions } from "@/lib/auth";
import { env } from "@/lib/env";
import { clientIp, fail, ok, readJson } from "@/lib/http";
import { log } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok({ authenticated: await adminSession() });
}

/** POST /api/admin/session — password login. */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const limited = rateLimit(`admin-login:${ip}`, { limit: 10, windowMs: 5 * 60_000 });
  if (!limited.allowed) {
    return fail("Too many attempts. Wait a few minutes.", 429, "RATE_LIMITED");
  }

  if (!env("ADMIN_PASSWORD")) {
    return fail("ADMIN_PASSWORD is not set on this instance.", 503, "NO_PASSWORD");
  }

  const body = await readJson<{ password?: unknown }>(req);
  if (!checkPassword(body?.password)) {
    log.warn("admin", "login_failed", { ip });
    return fail("Incorrect password.", 401, "BAD_PASSWORD");
  }

  await issueSessionCookie();
  log.info("admin", "login_ok", { ip });
  return ok({ authenticated: true });
}

/** DELETE /api/admin/session — logout. */
export async function DELETE(req: Request) {
  // ?all=1 signs out every device (e.g. after a lost laptop).
  if (new URL(req.url).searchParams.get("all") === "1" && (await adminSession())) await revokeAllSessions();
  clearSessionCookie();
  return ok({ authenticated: false });
}
