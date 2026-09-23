/**
 * MCP server — Streamable HTTP transport, JSON responses only (no SSE stream).
 * Spec: https://modelcontextprotocol.io/specification — this implements the
 * subset a tool-calling client needs: initialize, notifications/initialized,
 * ping, tools/list, tools/call. Shared by the keyed (/api/mcp) and public
 * (/api/mcp/public) endpoints; they differ only in toolset and gate.
 */
import { NextResponse } from "next/server";
import { CORS_HEADERS } from "../api-auth";
import { errorMessage, log } from "../logger";
import type { Tool, ToolCtx } from "./tools";

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26"];
const DEFAULT_VERSION = "2025-06-18";

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export type McpServer = {
  serverInfo: { name: string; version: string };
  instructions?: string;
  tools: Tool[];
  /** Runs before every method except initialize/ping. Return a JSON-RPC error to refuse. */
  gate: (req: Request) => Promise<{ code: number; message: string; status: number } | null>;
  ctx: (req: Request) => ToolCtx;
};

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export async function handleMcp(req: Request, server: McpServer): Promise<Response> {
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
    const refused = await server.gate(req);
    if (refused) {
      if (isNotification) return new NextResponse(null, { status: 202 });
      return json(rpcError(id, refused.code, refused.message), refused.status);
    }
  }

  try {
    switch (method) {
      case "initialize": {
        const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : undefined;
        const protocolVersion = requested && SUPPORTED_VERSIONS.includes(requested) ? requested : DEFAULT_VERSION;
        return json(
          rpcResult(id, {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: server.serverInfo,
            ...(server.instructions ? { instructions: server.instructions } : {}),
          })
        );
      }
      case "ping":
        return json(rpcResult(id, {}));
      case "tools/list":
        return json(rpcResult(id, { tools: server.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }));
      case "tools/call": {
        const name = params?.name;
        if (typeof name !== "string") return json(rpcError(id, -32602, "Invalid params: `name` is required"), 400);
        const tool = server.tools.find((t) => t.name === name);
        if (!tool) return json(rpcError(id, -32601, `Unknown tool: ${name}`), 404);
        const args = (params?.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
        const result = await tool.handler(args, server.ctx(req));
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
