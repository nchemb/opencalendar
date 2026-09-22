/**
 * Operations: the cron tick, canary, reconcile, health and signed outbound webhooks.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const sendMail = vi.hoisted(() => vi.fn(async (_a: { to: string | string[]; subject: string }) => true));
vi.mock("../../lib/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/mailer")>();
  return { ...actual, sendMail };
});

import { prisma } from "../../lib/db";
import { createFreeBooking } from "../../lib/booking";
import { tick, runCanary, runReconcile, cronAuthorized } from "../../lib/cron";
import { health } from "../../lib/health";
import { drainJobs } from "../../lib/jobs";
import { sign, verifySignature, newWebhookSecret } from "../../lib/webhooks";
import { memoryCalendarControl } from "../../lib/calendar-memory";
import { GET as healthRoute } from "../../app/api/health/route";
import { GET as tickRoute } from "../../app/api/cron/tick/route";
import { bookingInput, createHost, createMeetingType, createPaidMeetingType } from "../helpers/factories";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("cron tick", () => {
  test("auth: bearer header only, constant-time, query string ignored", async () => {
    const secret = process.env.CRON_SECRET!;
    expect(cronAuthorized(new Request("http://x/api/cron/tick", { headers: { authorization: `Bearer ${secret}` } }))).toBe(true);
    expect(cronAuthorized(new Request(`http://x/api/cron/tick?secret=${secret}`))).toBe(false);
    expect(cronAuthorized(new Request("http://x/api/cron/tick", { headers: { authorization: "Bearer nope" } }))).toBe(false);
    const res = await tickRoute(new Request("http://x/api/cron/tick"));
    expect(res.status).toBe(401);
  });

  test("releases stale unpaid holds across the instance", async () => {
    const host = await createHost();
    const mt = await createPaidMeetingType(host);
    const b = await prisma.booking.create({
      data: {
        hostId: host.id, meetingTypeId: mt.id, name: "x", email: "x@example.test", timezone: "UTC",
        startTime: new Date(Date.now() + 86_400_000), endTime: new Date(Date.now() + 86_400_000 + 1_800_000),
        status: "PENDING_PAYMENT", expiresAt: new Date(Date.now() - 1000),
      },
    });
    const r = await tick({ budgetMs: 5_000 });
    expect(r.holdsReleased).toBe(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("EXPIRED");
  });

  test("records its last run, which health reports", async () => {
    await createHost();
    const before = await health();
    expect(before.checks.cron.ok).toBe(false);
    await tick({ budgetMs: 2_000 });
    const after = await health();
    expect(after.checks.cron.ok).toBe(true);
  });
});

test("regression: a hold that never reached Stripe (NULL payment status) is swept and frees its slot", async () => {
  const host = await createHost();
  const mt = await createMeetingType(host);
  const { slotAt } = await import("../helpers/factories");
  const startTime = slotAt();
  // A free booking whose process died between reserve and confirm: PENDING_PAYMENT,
  // stripePaymentStatus NULL, hold expired.
  await prisma.booking.create({
    data: {
      hostId: host.id, meetingTypeId: mt.id, name: "ghost", email: "ghost@example.test", timezone: "UTC",
      startTime, endTime: new Date(startTime.getTime() + 1_800_000),
      status: "PENDING_PAYMENT", expiresAt: new Date(Date.now() - 1000),
    },
  });
  const winner = await createFreeBooking(host, mt, bookingInput({ startTime }));
  expect(winner.status).toBe("CONFIRMED");
});

describe("canary", () => {
  test("a public link with zero open slots raises a warning, which resolves once slots return", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host, { weeklyHours: {} as never });
    await runCanary();
    const alert = await prisma.alert.findFirstOrThrow({ where: { kind: "no_slots" } });
    expect(alert.resolvedAt).toBeNull();
    expect(alert.title).toContain(mt.slug);

    await prisma.meetingType.update({ where: { id: mt.id }, data: { weeklyHours: { "1": [{ start: "09:00", end: "17:00" }], "2": [{ start: "09:00", end: "17:00" }], "3": [{ start: "09:00", end: "17:00" }], "4": [{ start: "09:00", end: "17:00" }], "5": [{ start: "09:00", end: "17:00" }] } } });
    await runCanary();
    expect((await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } })).resolvedAt).not.toBeNull();
  });

  test("an unreadable calendar is a critical alert, not silence", async () => {
    const host = await createHost();
    await createMeetingType(host);
    memoryCalendarControl.breakFreeBusy();
    await runCanary();
    const alert = await prisma.alert.findFirstOrThrow({ where: { kind: "availability_error" } });
    expect(alert.severity).toBe("critical");
  });

  test("secret links are not canaried", async () => {
    const host = await createHost();
    await createMeetingType(host, { secret: true, weeklyHours: {} as never });
    const r = await runCanary();
    expect(r.checked).toBe(0);
  });

  test("missing email config raises one warning, alerts still land in the DB", async () => {
    const host = await createHost();
    await createMeetingType(host);
    await runCanary();
    await runCanary();
    const alerts = await prisma.alert.findMany({ where: { kind: "email_not_configured" } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].count).toBe(2);
  });
});

describe("reconcile", () => {
  test("an event deleted in the calendar by hand raises a drift alert", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host);
    const b = await createFreeBooking(host, mt, bookingInput());
    memoryCalendarControl.deleteExternally(b.googleEventId!);
    const r = await runReconcile();
    expect(r.drifted).toBe(1);
    const alert = await prisma.alert.findFirstOrThrow({ where: { kind: "calendar_drift", bookingId: b.id } });
    expect(alert.title).toMatch(/deleted/);
    // Detect only: the booking itself is untouched.
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CONFIRMED");
  });

  test("an event moved in the calendar raises a drift alert", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host);
    const b = await createFreeBooking(host, mt, bookingInput());
    memoryCalendarControl.moveExternally(b.googleEventId!, new Date(b.startTime.getTime() + 3_600_000), new Date(b.endTime.getTime() + 3_600_000));
    await runReconcile();
    expect((await prisma.alert.findFirstOrThrow({ where: { kind: "calendar_drift" } })).title).toMatch(/moved/);
  });

  test("a healthy calendar raises nothing", async () => {
    const host = await createHost();
    const mt = await createMeetingType(host);
    await createFreeBooking(host, mt, bookingInput());
    const r = await runReconcile();
    expect(r).toEqual({ checked: 1, drifted: 0 });
  });
});

describe("health", () => {
  test("503 with reasons when the calendar is disconnected", async () => {
    await createHost({ googleAuthError: "invalid_grant" });
    const res = await healthRoute();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.checks.calendar.ok).toBe(false);
  });

  test("200 once connected and the cron has run", async () => {
    await createHost();
    await tick({ budgetMs: 2_000 });
    const res = await healthRoute();
    expect(res.status).toBe(200);
  });
});

describe("outbound webhooks", () => {
  test("deliveries are HMAC-signed with a timestamp and verifiable", async () => {
    const secret = newWebhookSecret();
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: init.body as string });
      return new Response("ok", { status: 200 });
    }));
    await prisma.webhookEndpoint.create({ data: { url: "https://hooks.example.test/bk", secret, events: ["booking.created"] } });

    const host = await createHost();
    const mt = await createMeetingType(host);
    const b = await createFreeBooking(host, mt, bookingInput());
    await drainJobs({ budgetMs: 3_000 });

    expect(calls).toHaveLength(1);
    const { headers, body } = calls[0];
    expect(verifySignature(secret, body, headers["BookKit-Signature"])).toBe(true);
    expect(verifySignature("whsec_wrong", body, headers["BookKit-Signature"])).toBe(false);
    const payload = JSON.parse(body);
    expect(payload.event).toBe("booking.created");
    expect(payload.data.id).toBe(b.id);
    expect(payload.data.manageUrl).toContain(b.cancelToken);
  });

  test("an endpoint subscribed to other events receives nothing; a stale signature fails", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await prisma.webhookEndpoint.create({ data: { url: "https://hooks.example.test/x", secret: newWebhookSecret(), events: ["booking.cancelled"] } });
    const host = await createHost();
    const mt = await createMeetingType(host);
    await createFreeBooking(host, mt, bookingInput());
    await drainJobs({ budgetMs: 3_000 });
    expect(fetchMock).not.toHaveBeenCalled();

    const old = sign("s", "{}", Math.floor(Date.now() / 1000) - 3600);
    expect(verifySignature("s", "{}", old)).toBe(false);
  });

  test("a failing endpoint is retried with backoff", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const ep = await prisma.webhookEndpoint.create({ data: { url: "https://hooks.example.test/down", secret: newWebhookSecret() } });
    const host = await createHost();
    const mt = await createMeetingType(host);
    const b = await createFreeBooking(host, mt, bookingInput());
    const job = await prisma.job.findFirstOrThrow({ where: { bookingId: b.id, kind: "webhook" } });
    expect(job.doneAt).toBeNull();
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now());
    expect((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: ep.id } })).lastStatus).toBe(500);
  });
});
