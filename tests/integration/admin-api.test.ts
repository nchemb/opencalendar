/**
 * v2 admin API coverage.
 *
 * The admin session cookie is mocked locally (same pattern the v1 admin-auth
 * test used) rather than pulled from tests/helpers, since lib/auth.ts's shape
 * changed for v2 (adminSession() is async, there is no isAdmin()/assertAdmin()).
 * Factories are local too: tests/helpers/factories.ts still creates
 * MeetingType rows with v1 field names (minNoticeHours, bufferMinutes) that no
 * longer exist on the v2 schema — it is being rewritten for v2 in parallel by
 * the core checkout, so this file does not depend on it.
 */
import { createHash } from "node:crypto";
import { DEFAULT_WEEKLY_HOURS } from "../../lib/types";
import { beforeEach, describe, expect, test, vi } from "vitest";

const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    },
    delete: (name: string) => jar.delete(name),
  }),
}));

import { prisma } from "../../lib/db";
import { checkPassword, issueSessionCookie, clearSessionCookie, adminSession } from "../../lib/auth";
import { createApiKey, hashKey, verifyApiKey, revokeApiKey } from "../../lib/admin/api-keys";
import { deleteDataForEmail, exportDataForEmail } from "../../lib/admin/privacy";
import { parseMeetingTypeInput, parseWebhookEndpointInput, ValidationError } from "../../lib/meeting-type-input";
import { newWebhookSecret, WEBHOOK_EVENTS } from "../../lib/webhooks";

import { POST as createEventType } from "../../app/api/admin/event-types/route";
import { PATCH as patchEventType } from "../../app/api/admin/event-types/[id]/route";
import { POST as bookingAction } from "../../app/api/admin/bookings/[id]/route";
import { POST as createSchedule } from "../../app/api/admin/schedules/route";
import { POST as createBrand } from "../../app/api/admin/brands/route";
import { POST as createWebhookEndpoint } from "../../app/api/admin/webhook-endpoints/route";
import { POST as createApiKeyRoute } from "../../app/api/admin/api-keys/route";
import { POST as privacyRoute } from "../../app/api/admin/privacy/route";
import { POST as pauseRoute } from "../../app/api/admin/pause/route";
import { POST as tickRoute } from "../../app/api/admin/tick/route";
import { GET as exportCsvRoute } from "../../app/api/admin/bookings/export/route";
import { GET as explainRoute } from "../../app/api/admin/availability/explain/route";
import { POST as createLink } from "../../app/api/admin/event-types/[id]/links/route";

const PASSWORD = "test-admin-password"; // fixed by tests/helpers/test-env.ts's scrubEnv()

function req(url: string, init: RequestInit = {}) {
  return new Request(`http://localhost:3000${url}`, {
    headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
    ...init,
  });
}

async function login() {
  await issueSessionCookie();
}

/** Extra cleanup beyond what setup-integration.ts truncates: tables with no
 * hard FK to Host/Booking (WebhookEndpoint, ApiKey) or no FK relation declared
 * (Job, Alert) aren't swept by its `TRUNCATE ... CASCADE`. */
beforeEach(async () => {
  clearSessionCookie();
  await prisma.webhookEndpoint.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.job.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.analyticsDaily.deleteMany();
});

async function makeHost() {
  return prisma.host.create({
    data: { email: "host@example.test", timezone: "America/Chicago", googleRefreshToken: "test-token" },
  });
}

async function makeMeetingType(hostId: string, overrides: Record<string, unknown> = {}) {
  return prisma.meetingType.create({
    data: {
      hostId,
      slug: `type-${Math.random().toString(36).slice(2, 8)}`,
      name: "Test type",
      durationMinutes: 30,
      minNoticeMinutes: 0,
      weeklyHours: DEFAULT_WEEKLY_HOURS,
      locations: [{ kind: "google_meet" }],
      ...overrides,
    } as never,
  });
}

// ---------------------------------------------------------------------------
// Auth required on every admin route
// ---------------------------------------------------------------------------

describe("every admin route requires a session", () => {
  test.each([
    ["POST /api/admin/event-types", () => createEventType(req("/api/admin/event-types", { method: "POST", body: "{}" }))],
    ["POST /api/admin/schedules", () => createSchedule(req("/api/admin/schedules", { method: "POST", body: "{}" }))],
    ["POST /api/admin/brands", () => createBrand(req("/api/admin/brands", { method: "POST", body: "{}" }))],
    ["POST /api/admin/webhook-endpoints", () => createWebhookEndpoint(req("/api/admin/webhook-endpoints", { method: "POST", body: "{}" }))],
    ["POST /api/admin/api-keys", () => createApiKeyRoute(req("/api/admin/api-keys", { method: "POST", body: "{}" }))],
    ["POST /api/admin/privacy", () => privacyRoute(req("/api/admin/privacy", { method: "POST", body: "{}" }))],
    ["POST /api/admin/pause", () => pauseRoute(req("/api/admin/pause", { method: "POST", body: "{}" }))],
    ["POST /api/admin/tick", () => tickRoute()],
  ])("%s -> 401 without a session", async (_name, call) => {
    expect(await adminSession()).toBe(false);
    const res = await call();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  test("GET /api/admin/bookings/export -> 401 without a session (plain text, not JSON)", async () => {
    expect(await adminSession()).toBe(false);
    const res = await exportCsvRoute();
    expect(res.status).toBe(401);
  });

  test("PATCH /api/admin/event-types/[id] -> 401 without a session", async () => {
    const res = await patchEventType(req("/api/admin/event-types/x", { method: "PATCH", body: "{}" }), { params: { id: "x" } });
    expect(res.status).toBe(401);
  });

  test("POST /api/admin/bookings/[id] -> 401 without a session", async () => {
    const res = await bookingAction(req("/api/admin/bookings/x", { method: "POST", body: "{}" }), { params: { id: "x" } });
    expect(res.status).toBe(401);
  });

  test("GET /api/admin/availability/explain -> 401 without a session", async () => {
    const res = await explainRoute(req("/api/admin/availability/explain?meetingTypeId=x&date=2026-01-01"));
    expect(res.status).toBe(401);
  });

  test("POST /api/admin/event-types/[id]/links -> 401 without a session", async () => {
    const res = await createLink(req("/api/admin/event-types/x/links", { method: "POST", body: "{}" }), { params: { id: "x" } });
    expect(res.status).toBe(401);
  });

  test("logged in, the same routes accept requests", async () => {
    await login();
    expect(await adminSession()).toBe(true);
    const host = await makeHost();
    const res = await createBrand(
      req("/api/admin/brands", {
        method: "POST",
        body: JSON.stringify({ slug: "me", name: "My bookings", accentColor: "#FF6A00" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    await prisma.host.delete({ where: { id: host.id } }).catch(() => undefined);
  });
});

// ---------------------------------------------------------------------------
// Meeting type input validation / clamping
// ---------------------------------------------------------------------------

describe("parseMeetingTypeInput", () => {
  test("rejects an invalid slug", () => {
    expect(() => parseMeetingTypeInput({ slug: "Not A Slug!", name: "x" })).toThrow(ValidationError);
  });

  test("rejects a missing name", () => {
    expect(() => parseMeetingTypeInput({ slug: "ok-slug" })).toThrow(ValidationError);
  });

  test("clamps duration, buffers and limits into range", () => {
    const fields = parseMeetingTypeInput({
      slug: "clampy",
      name: "Clampy",
      durationMinutes: 100000,
      bufferBeforeMinutes: -5,
      bufferAfterMinutes: 999999,
      dailyLimit: 0,
      weeklyLimit: -1,
    });
    expect(fields.durationMinutes).toBe(720); // max
    expect(fields.bufferBeforeMinutes).toBe(0); // min
    expect(fields.bufferAfterMinutes).toBe(480); // max
    // 0 clamps to the type's min (1), same as the old dailyLimit `|| null` behavior.
    expect(fields.dailyLimit).toBe(1);
    expect(fields.weeklyLimit).toBe(1);
  });

  test("blank price is free (null), not zero", () => {
    expect(parseMeetingTypeInput({ slug: "free-one", name: "Free", priceCents: "" }).priceCents).toBeNull();
    expect(parseMeetingTypeInput({ slug: "free-two", name: "Free", priceCents: null }).priceCents).toBeNull();
  });

  test("rejects a bad hex color", () => {
    expect(() => parseMeetingTypeInput({ slug: "bad-color", name: "x", color: "orange" })).toThrow(ValidationError);
  });

  test("DATE_RANGE window requires both dates, in order", () => {
    expect(() =>
      parseMeetingTypeInput({ slug: "range-1", name: "x", windowType: "DATE_RANGE" })
    ).toThrow(ValidationError);
    expect(() =>
      parseMeetingTypeInput({
        slug: "range-2",
        name: "x",
        windowType: "DATE_RANGE",
        windowStart: "2026-06-01",
        windowEnd: "2026-01-01",
      })
    ).toThrow(ValidationError);
    const ok = parseMeetingTypeInput({
      slug: "range-3",
      name: "x",
      windowType: "DATE_RANGE",
      windowStart: "2026-01-01",
      windowEnd: "2026-06-01",
    });
    expect(ok.windowStart).toBe("2026-01-01");
    expect(ok.windowEnd).toBe("2026-06-01");
  });

  test("unknown refund policy falls back to before_cutoff", () => {
    expect(parseMeetingTypeInput({ slug: "policy", name: "x", refundPolicy: "whatever" }).refundPolicy).toBe(
      "before_cutoff"
    );
  });

  test("caps questions at MAX_QUESTIONS and drops choice questions with no options", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ label: `q${i}`, type: "short_text" }));
    expect(parseMeetingTypeInput({ slug: "many-q", name: "x", questions: many }).questions).toHaveLength(10);

    const noOptions = [{ label: "pick one", type: "single_choice", options: [] }];
    expect(parseMeetingTypeInput({ slug: "no-opt", name: "x", questions: noOptions }).questions).toHaveLength(0);
  });

  test("redirect URL must be http(s)", () => {
    expect(() => parseMeetingTypeInput({ slug: "bad-redirect", name: "x", redirectUrl: "javascript:alert(1)" })).toThrow(
      ValidationError
    );
  });
});

// ---------------------------------------------------------------------------
// Webhook endpoint: secret generation + URL validation
// ---------------------------------------------------------------------------

describe("webhook endpoints", () => {
  test("newWebhookSecret is a whsec_-prefixed, sufficiently random token", () => {
    const a = newWebhookSecret();
    const b = newWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{20,}$/);
    expect(a).not.toBe(b);
  });

  test("parseWebhookEndpointInput requires https (localhost excepted)", () => {
    expect(() => parseWebhookEndpointInput({ url: "http://example.com/hook" }, WEBHOOK_EVENTS)).toThrow(ValidationError);
    expect(parseWebhookEndpointInput({ url: "http://localhost:4000/hook" }, WEBHOOK_EVENTS).url).toContain("localhost");
    expect(parseWebhookEndpointInput({ url: "https://example.com/hook" }, WEBHOOK_EVENTS).url).toBe("https://example.com/hook");
  });

  test("only known events are kept", () => {
    const fields = parseWebhookEndpointInput(
      { url: "https://example.com/hook", events: ["booking.created", "not.a.real.event"] },
      WEBHOOK_EVENTS
    );
    expect(fields.events).toEqual(["booking.created"]);
  });

  test("POST /api/admin/webhook-endpoints stores the secret and returns it once", async () => {
    await login();
    const res = await createWebhookEndpoint(
      req("/api/admin/webhook-endpoints", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/hook", events: ["booking.created"] }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.secret).toMatch(/^whsec_/);

    const row = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.url).toBe("https://example.com/hook");
    expect(row.secret).toBe(body.secret); // shared HMAC secret, stored in the clear by design (unlike API keys)
    expect(row.events).toEqual(["booking.created"]);
  });
});

// ---------------------------------------------------------------------------
// API keys: plaintext is never stored
// ---------------------------------------------------------------------------

describe("API keys", () => {
  test("createApiKey stores only the sha256 hash, never the plaintext", async () => {
    const { id, plaintext } = await createApiKey("Zapier");
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id } });

    expect(row.hash).toBe(createHash("sha256").update(plaintext).digest("hex"));
    expect(row.hash).not.toBe(plaintext);
    expect(plaintext.startsWith("bk_live_")).toBe(true);
    expect(row.prefix).toBe(plaintext.slice(0, 12));

    // The row itself carries no column that reconstructs the plaintext.
    expect(Object.values(row)).not.toContain(plaintext);
  });

  test("verifyApiKey accepts the live key and rejects garbage", async () => {
    const { plaintext } = await createApiKey("Test");
    const verified = await verifyApiKey(plaintext);
    expect(verified?.name).toBe("Test");
    expect(await verifyApiKey("bk_live_not-a-real-key")).toBeNull();
    expect(await verifyApiKey(null)).toBeNull();
  });

  test("a revoked key stops verifying", async () => {
    const { id, plaintext } = await createApiKey("Revoke me");
    expect(await verifyApiKey(plaintext)).not.toBeNull();
    await revokeApiKey(id);
    expect(await verifyApiKey(plaintext)).toBeNull();
  });

  test("POST /api/admin/api-keys returns the plaintext once, hashed at rest", async () => {
    await login();
    const res = await createApiKeyRoute(req("/api/admin/api-keys", { method: "POST", body: JSON.stringify({ name: "CI" }) }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.hash).not.toBe(body.key);
    expect(hashKey(body.key)).toBe(row.hash);
  });
});

// ---------------------------------------------------------------------------
// Data deletion anonymizes
// ---------------------------------------------------------------------------

describe("privacy: delete data for email", () => {
  test("anonymizes name/email/answers/guests/utm and writes an audit event", async () => {
    const host = await makeHost();
    const mt = await makeMeetingType(host.id);
    const booking = await prisma.booking.create({
      data: {
        hostId: host.id,
        meetingTypeId: mt.id,
        name: "Real Name",
        email: "real@example.test",
        timezone: "UTC",
        answers: [{ id: "q1", label: "Why?", answer: "Because" }],
        guests: ["guest@example.test"],
        utm: { utm_source: "twitter" },
        startTime: new Date(Date.now() + 86_400_000),
        endTime: new Date(Date.now() + 86_400_000 + 1_800_000),
        status: "CONFIRMED",
      },
    });

    const result = await deleteDataForEmail("real@example.test");
    expect(result.anonymized).toBe(1);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.name).toBe("Deleted");
    expect(after.email).toBe(`deleted+${booking.id}@invalid`);
    expect(after.answers).toBeNull();
    expect(after.guests).toEqual([]);
    expect(after.utm).toBeNull();

    const events = await prisma.bookingEvent.findMany({ where: { bookingId: booking.id, type: "privacy_deleted" } });
    expect(events).toHaveLength(1);
  });

  test("is a no-op for an email with no bookings", async () => {
    expect(await deleteDataForEmail("nobody@example.test")).toEqual({ anonymized: 0 });
  });

  test("export returns bookings for the email, unmodified", async () => {
    const host = await makeHost();
    const mt = await makeMeetingType(host.id);
    await prisma.booking.create({
      data: {
        hostId: host.id,
        meetingTypeId: mt.id,
        name: "Export Me",
        email: "export@example.test",
        timezone: "UTC",
        startTime: new Date(Date.now() + 86_400_000),
        endTime: new Date(Date.now() + 86_400_000 + 1_800_000),
        status: "CONFIRMED",
      },
    });
    const data = await exportDataForEmail("export@example.test");
    expect(data.bookings).toHaveLength(1);
    expect(data.bookings[0].name).toBe("Export Me");
  });

  test("POST /api/admin/privacy requires a valid email", async () => {
    await login();
    const res = await privacyRoute(req("/api/admin/privacy", { method: "POST", body: JSON.stringify({ action: "delete", email: "not-an-email" }) }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// checkPassword sanity (guards the one gate the whole admin sits behind)
// ---------------------------------------------------------------------------

describe("checkPassword", () => {
  test("accepts the configured password and rejects everything else", () => {
    expect(checkPassword(PASSWORD)).toBe(true);
    expect(checkPassword("wrong")).toBe(false);
    expect(checkPassword(undefined)).toBe(false);
    expect(checkPassword(123)).toBe(false);
  });
});
