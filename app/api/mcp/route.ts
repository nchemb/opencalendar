/**
 * MCP server — Streamable HTTP transport, JSON responses only (no SSE stream).
 * Spec: https://modelcontextprotocol.io/specification — this implements the
 * subset a tool-calling client needs: initialize, notifications/initialized,
 * ping, tools/list, tools/call. Auth is the same Bearer API key as /api/v1.
 */
import { NextResponse } from "next/server";
import { CORS_HEADERS, apiFail, authenticateApiKey, corsPreflight } from "@/lib/api-auth";
import { findTool, TOOLS } from "@/lib/mcp/tools";
import { errorMessage, log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26"];
const DEFAULT_VERSION = "2025-06-18";
const SERVER_INFO = { name: "bookkit", version: "1.0.0" };

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return corsPreflight();
}

export async function GET() {
  // Streamable HTTP allows GET to open a server-initiated SSE stream; this server
  // never pushes unsolicited messages, so there is nothing to stream.
  return apiFail("This MCP endpoint only accepts POST.", 405, "METHOD_NOT_ALLOWED");
}

export async function POST(req: Request) {
  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }
  if (!body || typeof body.method !== "string") {
    return json(rpcError(body?.id ?? null, -32600, "Invalid Request"), 400);
  }

  const { method, params, id } = body;
  const isNotification = id === undefined;

  // Every notification (no id) gets the same empty 202, whether or not it's one we
  // recognize — the sender isn't waiting for a reply either way.
  if (method.startsWith("notifications/")) return new NextResponse(null, { status: 202 });

  const protoHeader = req.headers.get("mcp-protocol-version");
  if (protoHeader && !SUPPORTED_VERSIONS.includes(protoHeader)) {
    return json(rpcError(id, -32600, `Unsupported MCP-Protocol-Version: ${protoHeader}`), 400);
  }

  if (method !== "initialize" && method !== "ping") {
    const key = await authenticateApiKey(req);
    if (!key) {
      if (isNotification) return new NextResponse(null, { status: 202 });
      return json(rpcError(id, -32001, "Unauthorized: missing or invalid API key"), 401);
    }
  }

  try {
    switch (method) {
      case "initialize": {
        const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : undefined;
        const protocolVersion = requested && SUPPORTED_VERSIONS.includes(requested) ? requested : DEFAULT_VERSION;
        return json(rpcResult(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO }));
      }
      case "ping":
        return json(rpcResult(id, {}));
      case "tools/list":
        return json(rpcResult(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }));
      case "tools/call": {
        const name = params?.name;
        if (typeof name !== "string") return json(rpcError(id, -32602, "Invalid params: `name` is required"), 400);
        const tool = findTool(name);
        if (!tool) return json(rpcError(id, -32601, `Unknown tool: ${name}`), 404);
        const args = (params?.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
        const result = await tool.handler(args);
        return json(rpcResult(id, result));
      }
      default:
        if (isNotification) return new NextResponse(null, { status: 202 });
        return json(rpcError(id, -32601, `Method not found: ${method}`), 404);
    }
  } catch (err) {
    log.error("mcp", "handler_failed", { method, error: errorMessage(err) });
    if (isNotification) return new NextResponse(null, { status: 202 });
    return json(rpcError(id, -32000, "Internal error"), 500);
  }
}
