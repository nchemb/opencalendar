/**
 * The public HTTP surface: what a stranger can and cannot make the API do.
 * Route handlers are plain functions, so they are called directly with a Request.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../lib/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/mailer")>();
  return { ...actual, sendMail: vi.fn(async () => true) };
});

import { POST as createBooking } from "../../app/api/bookings/route";
import { POST as cancelBookingRoute } from "../../app/api/bookings/cancel/route";
import { GET as availabilityRoute } from "../../app/api/availability/route";
import { prisma } from "../../lib/db";
import { createFreeBooking } from "../../lib/booking";
import { memoryCalendarControl } from "../../lib/calendar-memory";
import {
  bookingInput,
  createHost,
  createMeetingType,
  createPaidMeetingType,
  slotAt,
} from "../helpers/factories";

/** Each test gets its own client IP so the in-memory rate limiter never bleeds across tests. */
let ipSeq = 0;
function nextIp(): string {
  return `203.0.113.${(ipSeq++ % 250) + 1}`;
}

function bookingRequest(body: unknown, ip = nextIp()): Request {
  return new Request("http://localhost:3000/api/bookings", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

async function json(res: Response) {
  return (await res.json()) as { ok: boolean; error?: string; code?: string; [k: string]: unknown };
}

/** A valid free-booking payload for the given meeting type. */
function validBody(slug: string, startTime = slotAt()) {
  return {
    slug,
    name: "Ada Lovelace",
    email: "Ada@Example.Test",
    timezone: "America/New_York",
    startTime: startTime.toISOString(),
    elapsedMs: 9000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/bookings", () => {
  test("books a free slot and returns the cancel token", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host, { slug: "intro" });

    const res = await createBooking(bookingRequest(validBody("intro")));
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    const booking = body.booking as Record<string, unknown>;
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.cancelToken).toBeTruthy();
    expect(booking.meetLink).toBeTruthy();

    // The email is normalised to lowercase on the way in.
    const stored = await prisma.booking.findFirstOrThrow();
    expect(stored.email).toBe("ada@example.test");
    expect(stored.meetingTypeId).toBe(meetingType.id);
  });

  test("a slot already taken comes back as 409, not 500", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro" });
    const startTime = slotAt();

    await createBooking(bookingRequest(validBody("intro", startTime)));
    const res = await createBooking(bookingRequest(validBody("intro", startTime)));
    const body = await json(res);

    expect(res.status).toBe(409);
    expect(body.code).toBe("SLOT_TAKEN");
  });

  test("an off-grid time is refused", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro" });

    // 03:07 local — nowhere near the 09:00–17:00 grid, and not on the boundary.
    const offGrid = slotAt(3);
    const res = await createBooking(bookingRequest(validBody("intro", offGrid)));
    const body = await json(res);

    expect(res.status).toBe(400);
    expect(body.code).toBe("INVALID_SLOT");
    expect(await prisma.booking.count()).toBe(0);
  });

  test("a paid meeting type cannot be booked for free through this route", async () => {
    const host = await createHost();
    await createPaidMeetingType(host, { slug: "paid" });

    const res = await createBooking(bookingRequest(validBody("paid")));
    const body = await json(res);

    expect(res.status).toBe(400);
    expect(body.code).toBe("PAYMENT_REQUIRED");
    expect(await prisma.booking.count()).toBe(0);
  });

  test("an inactive meeting type is not bookable", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "hidden", active: false });

    const res = await createBooking(bookingRequest(validBody("hidden")));
    expect(res.status).toBe(404);
  });

  test("a disconnected calendar returns the email-me fallback, not a crash", async () => {
    const host = await createHost({ googleAuthError: "invalid_grant" });
    await createMeetingType(host, { slug: "intro" });

    const res = await createBooking(bookingRequest(validBody("intro")));
    const body = await json(res);

    expect(res.status).toBe(503);
    expect(body.code).toBe("CALENDAR_DISCONNECTED");
    expect(String(body.error)).toMatch(/email/i);
  });

  describe("input validation", () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["a missing name", { name: "" }, "BAD_NAME"],
      ["a malformed email", { email: "not-an-email" }, "BAD_EMAIL"],
      ["an unknown timezone", { timezone: "Mars/Olympus_Mons" }, "BAD_TZ"],
      ["a non-ISO start time", { startTime: "tomorrow-ish" }, "BAD_TIME"],
      ["a start time with stray seconds", { startTime: "2026-09-03T15:00:30.000Z" }, "BAD_TIME"],
      ["an invalid slug", { slug: "Not A Slug" }, "BAD_SLUG"],
    ];

    for (const [label, override, code] of cases) {
      test(`rejects ${label}`, async () => {
        const host = await createHost();
        await createMeetingType(host, { slug: "intro" });

        const res = await createBooking(
          bookingRequest({ ...validBody("intro"), ...override })
        );
        expect(await json(res).then((b) => b.code)).toBe(code);
        expect(res.status).toBe(400);
        expect(await prisma.booking.count()).toBe(0);
      });
    }

    test("rejects a malformed body outright", async () => {
      const res = await createBooking(
        new Request("http://localhost:3000/api/bookings", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
          body: "{not json",
        })
      );
      expect(res.status).toBe(400);
      expect(await json(res).then((b) => b.code)).toBe("BAD_BODY");
    });
  });

  describe("bot filtering", () => {
    test("a filled honeypot field is rejected", async () => {
      const host = await createHost();
      await createMeetingType(host, { slug: "intro" });

      const res = await createBooking(
        bookingRequest({ ...validBody("intro"), company: "Acme Spam Co" })
      );

      expect(res.status).toBe(400);
      expect(await json(res).then((b) => b.code)).toBe("REJECTED");
      expect(await prisma.booking.count()).toBe(0);
    });

    test("a form completed impossibly fast is rejected", async () => {
      const host = await createHost();
      await createMeetingType(host, { slug: "intro" });

      const res = await createBooking(
        bookingRequest({ ...validBody("intro"), elapsedMs: 40 })
      );

      expect(res.status).toBe(400);
      expect(await json(res).then((b) => b.code)).toBe("REJECTED");
    });
  });

  describe("required questions", () => {
    test("a missing required answer is refused server-side", async () => {
      const host = await createHost();
      await createMeetingType(host, {
        slug: "intro",
        questions: [{ label: "What are you building?", required: true }] as object,
      });

      const res = await createBooking(
        bookingRequest({ ...validBody("intro"), answers: ["   "] })
      );

      expect(res.status).toBe(400);
      expect(await json(res).then((b) => b.code)).toBe("MISSING_ANSWER");
      expect(await prisma.booking.count()).toBe(0);
    });

    test("answers are stored against their labels", async () => {
      const host = await createHost();
      await createMeetingType(host, {
        slug: "intro",
        questions: [
          { label: "What are you building?", required: true },
          { label: "Budget?", required: false },
        ] as object,
      });

      const res = await createBooking(
        bookingRequest({ ...validBody("intro"), answers: ["A booking tool", ""] })
      );
      expect(res.status).toBe(200);

      const booking = await prisma.booking.findFirstOrThrow();
      expect(booking.answers).toEqual([
        { label: "What are you building?", answer: "A booking tool" },
      ]);
      expect(booking.customAnswer).toContain("A booking tool");
    });
  });

  test("the rate limiter closes the door after repeated attempts", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro" });
    const ip = "198.51.100.77";

    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await createBooking(
        bookingRequest({ ...validBody("intro"), email: `b${i}@example.test` }, ip)
      );
      codes.push(res.status);
    }

    expect(codes).toContain(429);
  });
});

describe("GET /api/availability", () => {
  function availabilityRequest(slug: string, from: Date, to: Date) {
    const url = new URL("http://localhost:3000/api/availability");
    url.searchParams.set("slug", slug);
    url.searchParams.set("from", from.toISOString());
    url.searchParams.set("to", to.toISOString());
    return new Request(url, { headers: { "x-forwarded-for": nextIp() } });
  }

  test("returns slots for an active meeting type", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro" });

    const from = slotAt(0);
    const to = slotAt(23);
    const res = await availabilityRoute(availabilityRequest("intro", from, to));
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(Array.isArray(body.slots)).toBe(true);
    expect((body.slots as string[]).length).toBeGreaterThan(0);
  });

  test("a booked slot disappears from the list", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host, { slug: "intro" });
    const startTime = slotAt(10);

    await createFreeBooking(host, meetingType, bookingInput({ startTime }));

    const res = await availabilityRoute(availabilityRequest("intro", slotAt(0), slotAt(23)));
    const body = await json(res);

    expect(body.slots as string[]).not.toContain(startTime.toISOString());
  });

  test("an unreachable calendar shows no slots rather than every slot", async () => {
    const host = await createHost();
    await createMeetingType(host, { slug: "intro" });

    memoryCalendarControl.breakFreeBusy();

    const res = await availabilityRoute(availabilityRequest("intro", slotAt(0), slotAt(23)));
    const body = await json(res);

    // Fail closed: no slots offered, and the page is told why.
    expect(body.slots ?? []).toEqual([]);
    expect(res.status).toBeGreaterThanOrEqual(200);
  });
});

describe("POST /api/bookings/cancel", () => {
  function cancelRequest(token: unknown) {
    return new Request("http://localhost:3000/api/bookings/cancel", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
      body: JSON.stringify({ token }),
    });
  }

  test("a valid token cancels the booking and removes the calendar event", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);
    const booking = await createFreeBooking(host, meetingType, bookingInput());
    expect(memoryCalendarControl.eventCount()).toBe(1);

    const res = await cancelBookingRoute(cancelRequest(booking.cancelToken));
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body.cancelled).toBe(true);
    expect(body.calendarRemoved).toBe(true);
    expect(memoryCalendarControl.eventCount()).toBe(0);

    const cancelled = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  test("an unknown token is a 404 and reveals nothing", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);
    await createFreeBooking(host, meetingType, bookingInput());

    const res = await cancelBookingRoute(cancelRequest("not-a-real-token"));
    expect(res.status).toBe(404);

    // The real booking is untouched.
    expect(await prisma.booking.count({ where: { status: "CONFIRMED" } })).toBe(1);
    expect(memoryCalendarControl.eventCount()).toBe(1);
  });

  test("a missing token is a 400", async () => {
    const res = await cancelBookingRoute(cancelRequest(""));
    expect(res.status).toBe(400);
  });

  test("cancelling twice is idempotent, not an error", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);
    const booking = await createFreeBooking(host, meetingType, bookingInput());

    await cancelBookingRoute(cancelRequest(booking.cancelToken));
    const res = await cancelBookingRoute(cancelRequest(booking.cancelToken));
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body.alreadyCancelled).toBe(true);
  });

  test("cancelling frees the slot for someone else", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);
    const startTime = slotAt();

    const first = await createFreeBooking(host, meetingType, bookingInput({ startTime }));
    await cancelBookingRoute(cancelRequest(first.cancelToken));

    // The partial unique index must not have burned the slot.
    const second = await createFreeBooking(
      host,
      meetingType,
      bookingInput({ startTime, email: "second@example.test" })
    );
    expect(second.status).toBe("CONFIRMED");
  });

  test("a calendar that refuses the delete still cancels the booking", async () => {
    const host = await createHost();
    const meetingType = await createMeetingType(host);
    const booking = await createFreeBooking(host, meetingType, bookingInput());

    memoryCalendarControl.breakDelete();

    const res = await cancelBookingRoute(cancelRequest(booking.cancelToken));
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body.calendarRemoved).toBe(false);

    const cancelled = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.googleSyncError).toMatch(/could not be deleted/i);
  });
});
