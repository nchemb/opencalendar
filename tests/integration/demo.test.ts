/**
 * The demo instance deletes every booking on a schedule, so the guards on that
 * endpoint matter: it must be impossible to trigger against a real deployment.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../lib/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/mailer")>();
  return { ...actual, sendMail: vi.fn(async () => true) };
});

import { POST as resetRoute } from "../../app/api/demo/reset/route";
import { prisma } from "../../lib/db";
import { createFreeBooking } from "../../lib/booking";
import { DEMO_HOST_EMAIL, resetDemoData } from "../../lib/demo";
import { bookingInput, createHost, createMeetingType } from "../helpers/factories";

const SECRET = "demo-reset-secret";

function resetRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/demo/reset", { method: "POST", headers });
}

async function json(res: Response) {
  return (await res.json()) as { ok: boolean; code?: string; meetingTypes?: number };
}

beforeEach(() => {
  process.env.DEMO_RESET_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.BOOKKIT_DEMO_MODE;
  delete process.env.DEMO_RESET_SECRET;
});

describe("POST /api/demo/reset", () => {
  test("is invisible on an instance that is not a demo", async () => {
    delete process.env.BOOKKIT_DEMO_MODE;

    const res = await resetRoute(resetRequest({ "x-bookkit-demo-secret": SECRET }));
    expect(res.status).toBe(404);
    expect(await json(res).then((b) => b.code)).toBe("NOT_DEMO");
  });

  test("a real deployment's bookings survive a stray call", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);
    await createFreeBooking(host, meetingType, bookingInput());

    delete process.env.BOOKKIT_DEMO_MODE;
    await resetRoute(resetRequest({ "x-bookkit-demo-secret": SECRET }));

    expect(await prisma.booking.count()).toBe(1);
  });

  test("refuses without the secret", async () => {
    process.env.BOOKKIT_DEMO_MODE = "1";

    expect((await resetRoute(resetRequest())).status).toBe(401);
    expect(
      (await resetRoute(resetRequest({ "x-bookkit-demo-secret": "wrong" }))).status
    ).toBe(401);
  });

  test("refuses when no secret is configured at all", async () => {
    process.env.BOOKKIT_DEMO_MODE = "1";
    delete process.env.DEMO_RESET_SECRET;

    const res = await resetRoute(resetRequest({ "x-bookkit-demo-secret": "anything" }));
    expect(res.status).toBe(503);
  });

  test("accepts either the header or a bearer token", async () => {
    process.env.BOOKKIT_DEMO_MODE = "1";

    expect((await resetRoute(resetRequest({ "x-bookkit-demo-secret": SECRET }))).status).toBe(200);
    expect((await resetRoute(resetRequest({ authorization: `Bearer ${SECRET}` }))).status).toBe(200);
  });

  test("clears bookings and restores the meeting types", async () => {
    process.env.BOOKKIT_DEMO_MODE = "1";
    await resetDemoData();

    const host = await prisma.host.findFirstOrThrow({ where: { email: DEMO_HOST_EMAIL } });
    const meetingType = await prisma.meetingType.findFirstOrThrow({
      where: { slug: "intro-call" },
      include: { schedule: true, brand: true },
    });
    await createFreeBooking(host, meetingType, bookingInput());
    expect(await prisma.booking.count()).toBe(1);

    const res = await resetRoute(resetRequest({ "x-bookkit-demo-secret": SECRET }));
    expect(res.status).toBe(200);
    expect(await json(res).then((b) => b.meetingTypes)).toBe(3);

    expect(await prisma.booking.count()).toBe(0);
    expect(await prisma.meetingType.count()).toBe(3);
    expect(await prisma.host.count({ where: { email: DEMO_HOST_EMAIL } })).toBe(1);
  });

  test("running it twice does not duplicate the host or the meeting types", async () => {
    process.env.BOOKKIT_DEMO_MODE = "1";

    await resetDemoData();
    await resetDemoData();
    await resetDemoData();

    expect(await prisma.host.count()).toBe(1);
    expect(await prisma.meetingType.count()).toBe(3);
  });
});
