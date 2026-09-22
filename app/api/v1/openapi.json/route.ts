import { NextResponse } from "next/server";
import { openApiDocument } from "@/lib/openapi";
import { CORS_HEADERS, corsPreflight } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/** GET /api/v1/openapi.json — no auth required, so tooling can discover the API. */
export async function GET() {
  return NextResponse.json(openApiDocument(), { headers: CORS_HEADERS });
}
