/**
 * Public MCP endpoint — no API key. Any AI agent can list the host's agent-bookable
 * event types, find open times and book free ones (paid ones return a checkout link
 * for a human). Per-IP rate limited. See lib/mcp/public-tools.ts and docs/MCP.md.
 */
import { apiFail, corsPreflight } from "@/lib/api-auth";
import { clientIp } from "@/lib/http";
import { handleMcp } from "@/lib/mcp/server";
import { PUBLIC_INSTRUCTIONS, PUBLIC_TOOLS } from "@/lib/mcp/public-tools";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export function OPTIONS() {
  return corsPreflight();
}

export async function GET() {
  return apiFail("This MCP endpoint only accepts POST.", 405, "METHOD_NOT_ALLOWED");
}

export function POST(req: Request) {
  return handleMcp(req, {
    serverInfo: { name: "opencalendar-public", version: "1.0.0" },
    instructions: PUBLIC_INSTRUCTIONS,
    tools: PUBLIC_TOOLS,
    gate: async (r) =>
      rateLimit(`mcp-public:${clientIp(r)}`, { limit: 60, windowMs: 60_000 }).allowed
        ? null
        : { code: -32029, message: "Too many requests. Slow down and retry in a minute.", status: 429 },
    ctx: (r) => ({ ip: clientIp(r) }),
  });
}
