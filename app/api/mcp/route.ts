/** Keyed MCP endpoint: the full toolset, same Bearer API key as /api/v1. See lib/mcp/server.ts. */
import { apiFail, authenticateApiKey, corsPreflight } from "@/lib/api-auth";
import { clientIp } from "@/lib/http";
import { handleMcp } from "@/lib/mcp/server";
import { TOOLS } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export function OPTIONS() {
  return corsPreflight();
}

export async function GET() {
  // Streamable HTTP allows GET to open a server-initiated SSE stream; this server
  // never pushes unsolicited messages, so there is nothing to stream.
  return apiFail("This MCP endpoint only accepts POST.", 405, "METHOD_NOT_ALLOWED");
}

export function POST(req: Request) {
  return handleMcp(req, {
    serverInfo: { name: "bookkit", version: "1.0.0" },
    tools: TOOLS,
    gate: async (r) => ((await authenticateApiKey(r)) ? null : { code: -32001, message: "Unauthorized: missing or invalid API key", status: 401 }),
    ctx: (r) => ({ ip: clientIp(r) }),
  });
}
