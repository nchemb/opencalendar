import { NextResponse } from "next/server";
import { health } from "@/lib/health";

export const dynamic = "force-dynamic";

/** GET /api/health — 200 when the instance can take bookings, 503 otherwise. Point an uptime monitor here. */
export async function GET() {
  const h = await health();
  return NextResponse.json(h, { status: h.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
