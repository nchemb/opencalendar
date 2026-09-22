/**
 * The v1 REST API: auth, event types, availability, and the booking lifecycle.
 *
 * Local factories, not tests/helpers/factories.ts: that file is mid-update for
 * v2 (its createMeetingType still writes pre-v2 field names and throws a Prisma
 * validation error against the current schema) — see the api-v1/mcp handoff.
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

import { GET as listEventTypes } from "../../app/api/v1/event-types/route";
import { GET as getAvailability } from "../../app/api/v1/event-types/[slug]/availability/route";
import { GET as listBookings, POST as createBooking } from "../../app/api/v1/bookings/route";
import { GET as getBooking } from "../../app/api/v1/bookings/[id]/route";
import { POST as cancelBooking } from "../../app/api/v1/bookings/[id]/cancel/route";
import { POST as rescheduleBooking } from "../../app/api/v1/bookings/[id]/reschedule/route";

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

function req(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Request {
  return new Request(`http://localhost:3000/api/v1${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(opts.token !== undefined ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

async function json(res: Response) {
  return (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: string; code?: string };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.apiKey.deleteMany();
});

describe("auth", () => {
  test("missing key is 401", async () => {
    const res = await listEventTypes(req("/event-types"));
    expect(res.status).toBe(401);
    expect(await json(res).then((b) => b.code)).toBe("UNAUTHORIZED");
  });

  test("garbage key is 401", async () => {
    const res = await listEventTypes(req("/event-types", { token: "not-a-real-key" }));
    expect(res.status).toBe(401);
  });

  test("a revoked key is 401", async () => {
    const key = generateApiKey("revoked");
    await prisma.apiKey.create({ data: { name: key.name, prefix: key.prefix, hash: key.hash, revokedAt: new Date() } });
    const res = await listEventTypes(req("/event-types", { token: key.token }));
    expect(res.status).toBe(401);
  });

  test("a valid key updates lastUsedAt", async () => {
    const key = generateApiKey("live");
    const row = await prisma.apiKey.create({ data: { name: key.name, prefix: key.prefix, hash: key.hash } });
    await createHost();
    const res = await listEventTypes(req("/event-types", { token: key.token }));
    expect(res.status).toBe(200);
    const updated = await prisma.apiKey.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.lastUsedAt).not.toBeNull();
  });
});

describe("GET /event-types", () => {
  test("lists active types, including secret ones", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "public-type", name: "Public" });
    await createMeetingType(host, { slug: "secret-type", name: "Secret", secret: true });
    await createMeetingType(host, { slug: "inactive-type", name: "Inactive", active: false });
    const token = await createApiKey();

    const res = await listEventTypes(req("/event-types", { token }));
    const body = await json(res);
    expect(res.status).toBe(200);
    const slugs = (body.data!.eventTypes as { slug: string }[]).map((t) => t.slug);
    expect(slugs).toEqual(expect.arrayContaining(["public-type", "secret-type"]));
    expect(slugs).not.toContain("inactive-type");
  });
});

describe("GET /event-types/{slug}/availability", () => {
  test("returns open slots for a valid range", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro" });
    const token = await createApiKey();

    const from = DateTime.now().setZone(HOST_TZ).toFormat("yyyy-MM-dd");
    const to = DateTime.now().setZone(HOST_TZ).plus({ days: 5 }).toFormat("yyyy-MM-dd");
    const res = await getAvailability(req(`/event-types/intro/availability?from=${from}&to=${to}`, { token }), {
      params: { slug: "intro" },
    });
    const body = await json(res);
    expect(res.status).toBe(200);
    expect((body.data!.slots as string[]).length).toBeGreaterThan(0);
  });

  test("an unknown slug is 404", async () => {
    const token = await createApiKey();
    const res = await getAvailability(req("/event-types/nope/availability?from=2026-01-01&to=2026-01-02", { token }), {
      params: { slug: "nope" },
    });
    expect(res.status).toBe(404);
  });
});

describe("booking lifecycle", () => {
  async function bookFree(token: string, slug: string, startTime = slotAt()) {
    return createBooking(
      req("/bookings", {
        method: "POST",
        token,
        body: { slug, name: "Ada Lovelace", email: "ada@example.test", timezone: "America/New_York", startTime: startTime.toISOString() },
      })
    );
  }

  test("books a free type", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro" });
    const token = await createApiKey();

    const res = await bookFree(token, "intro");
    const body = await json(res);
    expect(res.status).toBe(201);
    expect((body.data!.booking as Record<string, unknown>).status).toBe("CONFIRMED");
  });

  test("a paid type returns 402 with the booking page URL", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "paid", priceCents: 6900 });
    const token = await createApiKey();

    const res = await bookFree(token, "paid");
    const body = await json(res);
    expect(res.status).toBe(402);
    expect(body.code).toBe("PAYMENT_REQUIRED");
    expect(typeof body.error).toBe("string");
    expect((body as unknown as { bookingUrl: string }).bookingUrl).toContain("/paid");
  });

  test("a taken slot is 409", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro" });
    const token = await createApiKey();
    const startTime = slotAt();

    await bookFree(token, "intro", startTime);
    const res = await bookFree(token, "intro", startTime);
    expect(res.status).toBe(409);
    expect(await json(res).then((b) => b.code)).toBe("SLOT_TAKEN");
  });

  test("get, list, cancel and reschedule a booking", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro" });
    const token = await createApiKey();

    const created = await json(await bookFree(token, "intro"));
    const bookingId = (created.data!.booking as { id: string }).id;

    const getRes = await getBooking(req(`/bookings/${bookingId}`, { token }), { params: { id: bookingId } });
    expect(getRes.status).toBe(200);

    const listRes = await listBookings(req("/bookings?status=CONFIRMED", { token }));
    const listBody = await json(listRes);
    expect((listBody.data!.bookings as { id: string }[]).some((b) => b.id === bookingId)).toBe(true);

    const newStart = slotAt(11, 3);
    const rescheduleRes = await rescheduleBooking(
      req(`/bookings/${bookingId}/reschedule`, { method: "POST", token, body: { startTime: newStart.toISOString() } }),
      { params: { id: bookingId } }
    );
    const rescheduleBody = await json(rescheduleRes);
    expect(rescheduleRes.status).toBe(200);
    expect((rescheduleBody.data!.booking as { startTime: string }).startTime).toBe(newStart.toISOString());

    const cancelRes = await cancelBooking(req(`/bookings/${bookingId}/cancel`, { method: "POST", token, body: { reason: "test" } }), {
      params: { id: bookingId },
    });
    const cancelBody = await json(cancelRes);
    expect(cancelRes.status).toBe(200);
    expect((cancelBody.data!.booking as { status: string }).status).toBe("CANCELLED");
  });

  test("a missing booking id is 404 on get, cancel and reschedule", async () => {
    const token = await createApiKey();
    expect((await getBooking(req("/bookings/nope", { token }), { params: { id: "nope" } })).status).toBe(404);
    expect(
      (await cancelBooking(req("/bookings/nope/cancel", { method: "POST", token, body: {} }), { params: { id: "nope" } })).status
    ).toBe(404);
    expect(
      (
        await rescheduleBooking(req("/bookings/nope/reschedule", { method: "POST", token, body: { startTime: slotAt().toISOString() } }), {
          params: { id: "nope" },
        })
      ).status
    ).toBe(404);
  });
});
