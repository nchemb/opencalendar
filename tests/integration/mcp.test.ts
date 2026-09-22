/**
 * The MCP server: initialize handshake, tools/list, tools/call for the booking
 * lifecycle, and auth/protocol error handling.
 *
 * Local factories, not tests/helpers/factories.ts — see api-v1.test.ts's header
 * for why.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DateTime } from "luxon";
import type { Host, MeetingType } from "@prisma/client";

vi.mock("../../lib/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/mailer")>();
  return { ...actual, sendMail: vi.fn(async () => true) };
});

import { prisma } from "../../lib/db";
import { generateApiKey } from "../../lib/api-auth";
import { POST as mcp } from "../../app/api/mcp/route";

const HOST_TZ = "America/Chicago";
const ALL_WEEK = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "09:00", end: "17:00" }]]));

async function createHost(overrides: Partial<Host> = {}): Promise<Host> {
  return prisma.host.create({
    data: {
      email: "host@example.test",
      timezone: HOST_TZ,
      displayName: "Test Host",
      googleRefreshToken: "test-refresh-token",
      googleConnectedAt: new Date(),
      ...overrides,
    },
  });
}

async function createMeetingType(host: Host, overrides: Partial<MeetingType> = {}): Promise<MeetingType> {
  const slug = (overrides.slug as string) ?? `type-${Math.random().toString(36).slice(2, 9)}`;
  return prisma.meetingType.create({
    data: {
      hostId: host.id,
      slug,
      name: "Test Meeting",
      durationMinutes: 30,
      priceCents: null,
      currency: "usd",
      weeklyHours: ALL_WEEK as object,
      daysInAdvance: 30,
      minNoticeMinutes: 0,
      windowType: "CALENDAR_DAYS",
      active: true,
      ...overrides,
    } as never,
  });
}

function slotAt(hourLocal = 10, daysAhead = 2): Date {
  return DateTime.now()
    .setZone(HOST_TZ)
    .plus({ days: daysAhead })
    .set({ hour: hourLocal, minute: 0, second: 0, millisecond: 0 })
    .toJSDate();
}

async function createApiKey(name = "test key"): Promise<string> {
  const key = generateApiKey(name);
  await prisma.apiKey.create({ data: { name: key.name, prefix: key.prefix, hash: key.hash } });
  return key.token;
}

let rpcId = 0;
function rpc(method: string, params?: Record<string, unknown>, token?: string): Request {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, ...(params ? { params } : {}) }),
  });
}

async function rpcJson(res: Response) {
  return (await res.json()) as {
    jsonrpc: string;
    id: unknown;
    result?: { content?: { type: string; text: string }[]; structuredContent?: unknown; isError?: boolean; tools?: unknown[] };
    error?: { code: number; message: string };
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.apiKey.deleteMany();
});

describe("initialize / ping — no auth required", () => {
  test("initialize returns a supported protocol version and capabilities", async () => {
    const res = await mcp(rpc("initialize", { protocolVersion: "2025-06-18" }));
    const body = await rpcJson(res);
    expect(res.status).toBe(200);
    expect(body.result?.tools).toBeUndefined();
    const result = body.result as unknown as { protocolVersion: string; capabilities: { tools: object }; serverInfo: { name: string } };
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe("bookkit");
  });

  test("initialize with the older supported version echoes it back", async () => {
    const res = await mcp(rpc("initialize", { protocolVersion: "2025-03-26" }));
    const body = await rpcJson(res);
    expect((body.result as unknown as { protocolVersion: string }).protocolVersion).toBe("2025-03-26");
  });

  test("initialize with an unknown version falls back to the default", async () => {
    const res = await mcp(rpc("initialize", { protocolVersion: "1999-01-01" }));
    const body = await rpcJson(res);
    expect((body.result as unknown as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
  });

  test("notifications/initialized is a bare 202", async () => {
    const res = await mcp(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      })
    );
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  test("ping needs no auth", async () => {
    const res = await mcp(rpc("ping"));
    expect(res.status).toBe(200);
    expect((await rpcJson(res)).result).toEqual({});
  });
});

describe("auth", () => {
  test("tools/list without a key is a 401 JSON-RPC error", async () => {
    const res = await mcp(rpc("tools/list"));
    expect(res.status).toBe(401);
    const body = await rpcJson(res);
    expect(body.error?.code).toBe(-32001);
  });

  test("tools/list with a revoked key is a 401", async () => {
    const key = generateApiKey("revoked");
    await prisma.apiKey.create({ data: { name: key.name, prefix: key.prefix, hash: key.hash, revokedAt: new Date() } });
    const res = await mcp(rpc("tools/list", undefined, key.token));
    expect(res.status).toBe(401);
  });

  test("a malformed request is a JSON-RPC parse/invalid-request error", async () => {
    const badJson = await mcp(
      new Request("http://localhost:3000/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" })
    );
    expect((await rpcJson(badJson)).error?.code).toBe(-32700);

    const noMethod = await mcp(
      new Request("http://localhost:3000/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    );
    expect((await rpcJson(noMethod)).error?.code).toBe(-32600);
  });
});

describe("tools/list", () => {
  test("lists every tool with a name, description and inputSchema", async () => {
    const token = await createApiKey();
    const res = await mcp(rpc("tools/list", undefined, token));
    const body = await rpcJson(res);
    const tools = body.result!.tools as { name: string; description: string; inputSchema: object }[];
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["list_event_types", "find_available_times", "book_meeting", "cancel_booking", "reschedule_booking", "list_upcoming_bookings"])
    );
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.inputSchema).toBeTruthy();
    }
  });
});

describe("tools/call", () => {
  async function callTool(name: string, args: Record<string, unknown>, token: string) {
    const res = await mcp(rpc("tools/call", { name, arguments: args }, token));
    const body = await rpcJson(res);
    return { status: res.status, result: body.result! };
  }

  test("unknown tool name is a JSON-RPC error", async () => {
    const token = await createApiKey();
    const res = await mcp(rpc("tools/call", { name: "does_not_exist", arguments: {} }, token));
    const body = await rpcJson(res);
    expect(res.status).toBe(404);
    expect(body.error?.code).toBe(-32601);
  });

  test("list_event_types finds the seeded meeting type", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro", name: "Intro call" });
    const token = await createApiKey();

    const { result } = await callTool("list_event_types", {}, token);
    expect(result.isError).toBeFalsy();
    expect(result.content![0].text).toContain("intro");
    expect((result.structuredContent as { eventTypes: { slug: string }[] }).eventTypes.map((t) => t.slug)).toContain("intro");
  });

  test("find_available_times returns open slots for a real event type", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro" });
    const token = await createApiKey();

    const from = DateTime.now().setZone(HOST_TZ).toFormat("yyyy-MM-dd");
    const to = DateTime.now().setZone(HOST_TZ).plus({ days: 5 }).toFormat("yyyy-MM-dd");
    const { result } = await callTool("find_available_times", { slug: "intro", from, to, timezone: HOST_TZ }, token);
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { slots: string[] };
    expect(structured.slots.length).toBeGreaterThan(0);
  });

  test("find_available_times on an unknown slug is a tool error, not a crash", async () => {
    const token = await createApiKey();
    const { result } = await callTool("find_available_times", { slug: "nope", from: "2026-01-01", to: "2026-01-02" }, token);
    expect(result.isError).toBe(true);
  });

  test("book_meeting books a free type end to end", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro" });
    const token = await createApiKey();

    const startTime = slotAt();
    const { result } = await callTool(
      "book_meeting",
      { slug: "intro", name: "Ada Lovelace", email: "ada@example.test", timezone: "America/New_York", startTime: startTime.toISOString() },
      token
    );
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { booking: { status: string; id: string } };
    expect(structured.booking.status).toBe("CONFIRMED");

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: structured.booking.id } });
    expect(stored.status).toBe("CONFIRMED");
  });

  test("book_meeting on a paid type returns the booking link instead of booking", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "paid", priceCents: 6900 });
    const token = await createApiKey();

    const { result } = await callTool(
      "book_meeting",
      { slug: "paid", name: "Ada", email: "ada@example.test", timezone: "America/New_York", startTime: slotAt().toISOString() },
      token
    );
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { requiresPayment: boolean; bookingUrl: string };
    expect(structured.requiresPayment).toBe(true);
    expect(structured.bookingUrl).toContain("/paid");
    expect(await prisma.booking.count()).toBe(0);
  });

  test("a taken slot comes back as a tool error, not a crash", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro" });
    const token = await createApiKey();
    const startTime = slotAt();
    const args = { slug: "intro", name: "Ada", email: "ada@example.test", timezone: "America/New_York", startTime: startTime.toISOString() };

    await callTool("book_meeting", args, token);
    const { result } = await callTool("book_meeting", { ...args, email: "second@example.test" }, token);
    expect(result.isError).toBe(true);
    expect(result.content![0].text).toMatch(/taken/i);
  });

  test("cancel_booking and reschedule_booking act on a real booking", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro" });
    const token = await createApiKey();

    const booked = await callTool(
      "book_meeting",
      { slug: "intro", name: "Ada", email: "ada@example.test", timezone: "America/New_York", startTime: slotAt().toISOString() },
      token
    );
    const bookingId = (booked.result.structuredContent as { booking: { id: string } }).booking.id;

    const newStart = slotAt(11, 3);
    const rescheduled = await callTool("reschedule_booking", { bookingId, startTime: newStart.toISOString() }, token);
    expect(rescheduled.result.isError).toBeFalsy();
    const rescheduledBooking = (rescheduled.result.structuredContent as { booking: { startTime: string } }).booking;
    expect(rescheduledBooking.startTime).toBe(newStart.toISOString());

    const cancelled = await callTool("cancel_booking", { bookingId, reason: "no longer needed" }, token);
    expect(cancelled.result.isError).toBeFalsy();
    const cancelledBooking = (cancelled.result.structuredContent as { booking: { status: string } }).booking;
    expect(cancelledBooking.status).toBe("CANCELLED");
  });

  test("list_upcoming_bookings lists a confirmed booking", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro" });
    const token = await createApiKey();

    await callTool(
      "book_meeting",
      { slug: "intro", name: "Ada", email: "ada@example.test", timezone: "America/New_York", startTime: slotAt().toISOString() },
      token
    );

    const { result } = await callTool("list_upcoming_bookings", {}, token);
    const structured = result.structuredContent as { bookings: { email: string }[] };
    expect(structured.bookings.some((b) => b.email === "ada@example.test")).toBe(true);
  });
});
