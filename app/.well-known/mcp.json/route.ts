import { mcpDescriptor } from "@/lib/mcp/discovery";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await mcpDescriptor(), {
    headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  });
}
