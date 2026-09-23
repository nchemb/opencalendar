/**
 * The public (keyless) MCP endpoint: only agent-bookable, non-secret types are
 * visible; free bookings go through the normal claim path and send the normal
 * emails; paid types return a checkout link and book nothing; abuse limits trip.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DateTime } from "luxon";
import type { Host, MeetingType } from "@prisma/client";

const sendMail = vi.hoisted(() => vi.fn(async (_args: { to: string | string[]; subject: string; html: string }) => true));

vi.mock("../../lib/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/mailer")>();
  return { ...actual, sendMail };
});

import { prisma } from "../../lib/db";
import { POST as mcp } from "../../app/api/mcp/public/route";
import { GET as llms } from "../../app/llms.txt/route";
import { GET as wellKnown } from "../../app/.well-known/mcp.json/route";
import { parseBookingParams } from "../../lib/ui/params";
import { sendHostNotification } from "../../lib/emails";
import { loadCtx } from "../../lib/booking";

const HOST_TZ = "America/Chicago";
const ALL_WEEK = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "09:00", end: "17:00" }]]));

async function createHost(): Promise<Host> {
  return prisma.host.create({
    data: { email: "host@example.test", timezone: HOST_TZ, displayName: "Rivera Studio", googleRefreshToken: "t", googleConnectedAt: new Date() },
  });
}

async function createType(host: Host, overrides: Partial<MeetingType> = {}): Promise<MeetingType> {
  return prisma.meetingType.create({
    data: {
      hostId: host.id,
      slug: `type-${Math.random().toString(36).slice(2, 9)}`,
      name: "Intro call",
      durationMinutes: 30,
      weeklyHours: ALL_WEEK as object,
      daysInAdvance: 30,
      minNoticeMinutes: 0,
      windowType: "CALENDAR_DAYS",
      active: true,
      agentBookable: true,
      ...overrides,
    } as never,
  });
}

function slotAt(hourLocal = 10, daysAhead = 2): Date {
  return DateTime.now().setZone(HOST_TZ).plus({ days: daysAhead }).set({ hour: hourLocal, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}

let rpcId = 0;
let ipSeq = 0;
let ip = "";
beforeEach(() => {
  vi.clearAllMocks();
  ip = `203.0.113.${++ipSeq}`; // fresh rate-limit bucket per test
});

async function call(name: string, args: Record<string, unknown> = {}, fromIp = ip) {
  const res = await mcp(
    new Request("http://localhost:3000/api/mcp/public", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": fromIp },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
    })
  );
  const body = (await res.json()) as { result?: { content: { text: string }[]; structuredContent?: any; isError?: boolean }; error?: { code: number } };
  return { status: res.status, result: body.result!, error: body.error };
}

const invitee = (startTime: Date, email = "ada@example.test") => ({
  name: "Ada Lovelace",
  email,
  timezone: "America/New_York",
  startTime: startTime.toISOString(),
});

describe("visibility", () => {
  test("tools/list needs no key and exposes only the booking tools", async () => {
    const res = await mcp(
      new Request("http://localhost:3000/api/mcp/public", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
    );
    expect(res.status).toBe(200);
    const names = ((await res.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(names.sort()).toEqual(["book_meeting", "find_available_times", "list_event_types"]);
  });

  test("secret and non-agent-bookable types are invisible everywhere", async () => {
    const host = await createHost();
    await createType(host, { slug: "open" });
    await createType(host, { slug: "hidden", secret: true });
    await createType(host, { slug: "optout", agentBookable: false });

    const list = await call("list_event_types");
    const slugs = list.result.structuredContent.eventTypes.map((t: { slug: string }) => t.slug);
    expect(slugs).toEqual(["open"]);
    expect(JSON.stringify(list.result)).not.toContain("host@example.test");

    for (const slug of ["hidden", "optout"]) {
      const times = await call("find_available_times", { slug, from: "2026-10-01", to: "2026-10-02" });
      expect(times.result.isError).toBe(true);
      const book = await call("book_meeting", { slug, ...invitee(slotAt()) });
      expect(book.result.isError).toBe(true);
    }
    expect(await prisma.booking.count()).toBe(0);

    const txt = await (await llms()).text();
    expect(txt).toContain("/api/mcp/public");
    expect(txt).toContain("`open`");
    expect(txt).not.toContain("hidden");
    expect(txt).not.toContain("optout");
    const desc = await (await wellKnown()).json();
    expect(desc.url).toMatch(/\/api\/mcp\/public$/);
    expect(desc.eventTypes).toEqual(["open"]);
  });
});

describe("booking", () => {
  test("a free type books through the normal path, tagged as agent, with the normal emails", async () => {
    const host = await createHost();
    const mt = await createType(host, { slug: "intro" });

    const times = await call("find_available_times", {
      slug: "intro",
      from: DateTime.now().setZone(HOST_TZ).toFormat("yyyy-MM-dd"),
      to: DateTime.now().setZone(HOST_TZ).plus({ days: 5 }).toFormat("yyyy-MM-dd"),
    });
    expect(times.result.structuredContent.slots.length).toBeGreaterThan(0);

    const { result } = await call("book_meeting", { slug: "intro", ...invitee(slotAt()), notes: "Wants to talk pricing", agentName: "TestAgent" });
    expect(result.isError).toBeFalsy();
    const b = result.structuredContent.booking;
    expect(b.status).toBe("CONFIRMED");
    expect(b.manageUrl).toContain("/booking/");

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(stored.meetingTypeId).toBe(mt.id);
    expect(stored.googleEventId).toBeTruthy(); // calendar invite written, same as a human booking
    expect(stored.utm).toEqual({ ref: "agent", agent_client: "TestAgent" });
    expect(stored.customAnswer).toContain("Wants to talk pricing");

    // Same outbox side effects a human booking queues (tests run without a mail provider, so they complete as skipped).
    const jobs = await prisma.job.findMany({ where: { bookingId: b.id, kind: "email" } });
    expect(jobs.map((j) => (j.payload as { template: string }).template).sort()).toEqual(["confirmation", "host_new"]);

    // The host's "New booking" email names the agent source.
    await sendHostNotification({ ...(await loadCtx(b.id)), mailKey: "t" } as never);
    const hostMail = sendMail.mock.calls.map(([m]) => m).find((m) => [m.to].flat().includes("host@example.test"));
    expect(hostMail?.html).toContain("booked by an AI agent");
    expect(hostMail?.html).toContain("agent_client=TestAgent");
  });

  test("a paid type returns a checkout URL with the slot preselected and creates no booking", async () => {
    const host = await createHost();
    await createType(host, { slug: "paid", priceCents: 6900 });
    const start = slotAt();

    const { result } = await call("book_meeting", { slug: "paid", ...invitee(start) });
    expect(result.isError).toBeFalsy();
    const { checkoutUrl, requiresPayment } = result.structuredContent;
    expect(requiresPayment).toBe(true);
    expect(await prisma.booking.count()).toBe(0);

    const url = new URL(checkoutUrl);
    expect(url.pathname).toBe("/paid");
    const params = parseBookingParams(Object.fromEntries(url.searchParams), []);
    expect(params.time).toBe(start.toISOString());
    expect(params.tz).toBe("America/New_York");
    expect(params.email).toBe("ada@example.test");
  });

  test("one upcoming agent booking per email per event type", async () => {
    const host = await createHost();
    await createType(host, { slug: "intro" });

    const first = await call("book_meeting", { slug: "intro", ...invitee(slotAt(10)) });
    expect(first.result.isError).toBeFalsy();
    const second = await call("book_meeting", { slug: "intro", ...invitee(slotAt(14)) });
    expect(second.result.isError).toBe(true);
    expect(second.result.content[0].text).toMatch(/already has an upcoming booking/);

    const other = await call("book_meeting", { slug: "intro", ...invitee(slotAt(14), "grace@example.test") });
    expect(other.result.isError).toBeFalsy();
  });

  test("per-IP booking rate limit trips", async () => {
    const host = await createHost();
    await createType(host, { slug: "intro" });
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await call("book_meeting", { slug: "intro", ...invitee(slotAt(9 + i), `p${i}@example.test`) }));
    }
    expect(results.slice(0, 5).every((r) => !r.result.isError)).toBe(true);
    expect(results[5].result.isError).toBe(true);
    expect(results[5].result.content[0].text).toMatch(/Too many/);
  });

  test("per-IP request rate limit returns 429", async () => {
    await createHost();
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await call("list_event_types")).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });

  test("two concurrent public bookings for one slot: exactly one wins", async () => {
    const host = await createHost();
    await createType(host, { slug: "intro" });
    const start = slotAt();

    const [a, b] = await Promise.all([
      call("book_meeting", { slug: "intro", ...invitee(start, "a@example.test") }, "198.51.100.1"),
      call("book_meeting", { slug: "intro", ...invitee(start, "b@example.test") }, "198.51.100.2"),
    ]);
    expect([a, b].filter((r) => !r.result.isError)).toHaveLength(1);
    expect([a, b].find((r) => r.result.isError)!.result.content[0].text).toMatch(/taken/i);
    expect(await prisma.booking.count({ where: { status: "CONFIRMED" } })).toBe(1);
  });
});
