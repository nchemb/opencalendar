import { llmsTxt } from "@/lib/mcp/discovery";

export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(await llmsTxt(), {
    headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  });
}
