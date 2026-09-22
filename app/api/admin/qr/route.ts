import { adminSession } from "@/lib/auth";
import { qrPng, qrSvg } from "@/lib/admin/qr";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/admin/qr?url=...&format=png|svg */
export async function GET(req: Request) {
  if (!(await adminSession())) return fail("Not authorized.", 401, "UNAUTHORIZED");
  const params = new URL(req.url).searchParams;
  const url = params.get("url");
  if (!url) return fail("url is required.", 400, "VALIDATION");
  const format = params.get("format") === "svg" ? "svg" : "png";

  if (format === "svg") {
    const svg = await qrSvg(url);
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
  }
  const png = await qrPng(url);
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
}
