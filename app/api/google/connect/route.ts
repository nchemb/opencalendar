import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { hasGoogleOAuth } from "@/lib/env";
import { authUrl } from "@/lib/google";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/google/connect — admin-only kickoff of the Calendar OAuth consent flow. */
export async function GET() {
  if (!isAdmin()) return fail("Not authorized.", 401, "UNAUTHORIZED");
  if (!hasGoogleOAuth()) {
    return fail("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.", 503, "NO_OAUTH_CONFIG");
  }

  const state = randomBytes(16).toString("hex");
  cookies().set("bookkit_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(authUrl(state));
}
