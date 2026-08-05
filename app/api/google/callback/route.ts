import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { appUrl, env } from "@/lib/env";
import { exchangeCode } from "@/lib/google";
import { errorMessage, log } from "@/lib/logger";

export const dynamic = "force-dynamic";

function back(status: string, detail?: string) {
  const url = new URL(`${appUrl()}/admin/settings`);
  url.searchParams.set("google", status);
  if (detail) url.searchParams.set("detail", detail.slice(0, 200));
  return NextResponse.redirect(url);
}

/** GET /api/google/callback — stores the refresh token on the single host row. */
export async function GET(req: Request) {
  if (!isAdmin()) return back("error", "Admin session expired — log in and try again.");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return back("error", oauthError);
  if (!code) return back("error", "No authorization code returned.");

  const expected = cookies().get("bookkit_oauth_state")?.value;
  if (!expected || !state || expected !== state) {
    return back("error", "State mismatch — restart the connection.");
  }
  cookies().set("bookkit_oauth_state", "", { path: "/", maxAge: 0 });

  try {
    const tokens = await exchangeCode(code);
    const email = env("ADMIN_EMAIL");
    if (!email) return back("error", "ADMIN_EMAIL is not set.");

    const existing = await prisma.host.findFirst({ orderBy: { createdAt: "asc" } });

    const data = {
      email,
      googleRefreshToken: tokens.refresh_token!,
      googleAccessToken: tokens.access_token ?? null,
      googleTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      googleCalendarId: "primary",
      googleConnectedAt: new Date(),
      googleAuthError: null,
    };

    if (existing) {
      await prisma.host.update({ where: { id: existing.id }, data });
    } else {
      await prisma.host.create({
        data: { ...data, timezone: env("HOST_TIMEZONE") || "America/Chicago" },
      });
    }

    log.info("google", "connected", { email });
    return back("connected");
  } catch (err) {
    const reason = errorMessage(err);
    log.error("google", "connect_failed", { error: reason });
    return back("error", reason);
  }
}
