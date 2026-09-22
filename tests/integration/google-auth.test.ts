/**
 * README claim: "Google token revoked → Booking pages switch to an 'email me'
 * fallback and you get an alert."
 *
 * The rest of the suite runs on the in-memory calendar, so this file is the one
 * that exercises lib/google.ts itself, with googleapis mocked underneath. It
 * covers the distinction that matters: a revoked token must flag the host and
 * block bookings, while a transient blip must not.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const googleState = vi.hoisted(() => ({
  refresh: vi.fn(),
  freebusyQuery: vi.fn(),
  eventsInsert: vi.fn(),
  eventsDelete: vi.fn(),
}));

vi.mock("googleapis", () => {
  class OAuth2 {
    credentials: Record<string, unknown> = {};
    setCredentials(c: Record<string, unknown>) {
      this.credentials = c;
    }
    generateAuthUrl() {
      return "https://accounts.google.test/o/oauth2/auth";
    }
    async getToken() {
      return { tokens: { refresh_token: "new-refresh-token" } };
    }
    async refreshAccessToken() {
      return googleState.refresh();
    }
  }

  return {
    google: {
      auth: { OAuth2 },
      calendar: () => ({
        freebusy: { query: googleState.freebusyQuery },
        events: { insert: googleState.eventsInsert, delete: googleState.eventsDelete },
      }),
    },
  };
});

const sendMail = vi.hoisted(() =>
  vi.fn(async (_args: { to: string | string[]; subject: string }) => true)
);

vi.mock("../../lib/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/mailer")>();
  return { ...actual, sendMail };
});

import { prisma } from "../../lib/db";
import { GoogleApiError, GoogleAuthError } from "../../lib/calendar-types";
import { deleteEvent, freeBusy } from "../../lib/google";
import { hostBookingBlocked } from "../../lib/booking";
import { createHost } from "../helpers/factories";

/** An auth error shaped the way google-auth-library reports a dead refresh token. */
function invalidGrant() {
  return Object.assign(new Error("invalid_grant: Token has been expired or revoked."), {
    code: 400,
  });
}

const FROM = new Date("2026-09-03T00:00:00Z");
const TO = new Date("2026-09-04T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  sendMail.mockImplementation(async () => true);
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

  googleState.refresh.mockResolvedValue({
    credentials: { access_token: "fresh-access-token", expiry_date: Date.now() + 3_600_000 },
  });
  googleState.freebusyQuery.mockResolvedValue({ data: { calendars: { primary: { busy: [] } } } });
});

describe("a revoked refresh token", () => {
  test("flags the host, alerts, and reports an auth error", async () => {
    const host = await createHost();
    googleState.refresh.mockRejectedValue(invalidGrant());

    await expect(freeBusy(host, FROM, TO)).rejects.toBeInstanceOf(GoogleAuthError);

    const flagged = await prisma.host.findUniqueOrThrow({ where: { id: host.id } });
    expect(flagged.googleAuthError).toContain("invalid_grant");

    expect(sendMail.mock.calls.some(([a]) => a.subject.includes("Google Calendar disconnected"))).toBe(
      true
    );
  });

  test("a flagged host blocks booking so the page can show the fallback", async () => {
    const host = await createHost();
    googleState.refresh.mockRejectedValue(invalidGrant());
    await expect(freeBusy(host, FROM, TO)).rejects.toThrow();

    const flagged = await prisma.host.findUniqueOrThrow({ where: { id: host.id } });
    expect(hostBookingBlocked(flagged)).toBe(true);
  });

  test("a host that never connected is an auth error, not a crash", async () => {
    const host = await createHost({ googleRefreshToken: null, googleConnectedAt: null });
    await expect(freeBusy(host, FROM, TO)).rejects.toBeInstanceOf(GoogleAuthError);
    expect(hostBookingBlocked(host)).toBe(true);
  });
});

describe("a transient Google failure", () => {
  test("does not flag the host as disconnected", async () => {
    const host = await createHost();
    googleState.refresh.mockRejectedValue(new Error("ETIMEDOUT"));

    await expect(freeBusy(host, FROM, TO)).rejects.toBeInstanceOf(GoogleApiError);

    const unchanged = await prisma.host.findUniqueOrThrow({ where: { id: host.id } });
    expect(unchanged.googleAuthError).toBeNull();
    expect(hostBookingBlocked(unchanged)).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("a freebusy error for the calendar surfaces as an API error", async () => {
    const host = await createHost();
    googleState.freebusyQuery.mockResolvedValue({
      data: { calendars: { primary: { errors: [{ reason: "notFound" }] } } },
    });

    await expect(freeBusy(host, FROM, TO)).rejects.toBeInstanceOf(GoogleApiError);
  });
});

describe("token refresh bookkeeping", () => {
  test("a successful refresh persists the new access token and clears the error flag", async () => {
    const host = await createHost({ googleAuthError: "previously broken" });

    await freeBusy(host, FROM, TO);

    const updated = await prisma.host.findUniqueOrThrow({ where: { id: host.id } });
    expect(updated.googleAccessToken).toBe("fresh-access-token");
    expect(updated.googleTokenExpiresAt).not.toBeNull();
    expect(updated.googleAuthError).toBeNull();
  });

  test("a still-valid access token is not refreshed", async () => {
    const host = await createHost({
      googleAccessToken: "still-good",
      googleTokenExpiresAt: new Date(Date.now() + 3_600_000),
    });

    await freeBusy(host, FROM, TO);
    expect(googleState.refresh).not.toHaveBeenCalled();
  });
});

describe("deleting an event", () => {
  test("an event already gone counts as success", async () => {
    const host = await createHost();
    for (const code of [404, 410]) {
      googleState.eventsDelete.mockRejectedValueOnce(Object.assign(new Error("gone"), { code }));
      await expect(deleteEvent(host, "evt-1")).resolves.toBeUndefined();
    }
  });

  test("other failures propagate", async () => {
    const host = await createHost();
    googleState.eventsDelete.mockRejectedValueOnce(
      Object.assign(new Error("server error"), { code: 500 })
    );
    await expect(deleteEvent(host, "evt-1")).rejects.toBeInstanceOf(GoogleApiError);
  });
});

describe("multiple conflict calendars", () => {
  test("busy time from every selected calendar blocks, merged into one list", async () => {
    const host = await createHost({
      googleAccessToken: "tok",
      googleTokenExpiresAt: new Date(Date.now() + 3_600_000),
      conflictCalendarIds: ["personal@example.test"],
    });
    googleState.freebusyQuery.mockResolvedValue({
      data: {
        calendars: {
          primary: { busy: [{ start: "2026-09-03T15:00:00Z", end: "2026-09-03T16:00:00Z" }] },
          "personal@example.test": { busy: [{ start: "2026-09-03T18:00:00Z", end: "2026-09-03T18:30:00Z" }] },
        },
      },
    });
    const busy = await freeBusy(host, FROM, TO);
    expect(googleState.freebusyQuery.mock.calls[0][0].requestBody.items).toEqual([
      { id: "primary" },
      { id: "personal@example.test" },
    ]);
    expect(busy.map((b) => b.calendarId)).toEqual(["primary", "personal@example.test"]);
  });

  test("an error on any one calendar fails closed instead of reading it as free", async () => {
    const host = await createHost({
      googleAccessToken: "tok",
      googleTokenExpiresAt: new Date(Date.now() + 3_600_000),
      conflictCalendarIds: ["gone@example.test"],
    });
    googleState.freebusyQuery.mockResolvedValue({
      data: {
        calendars: {
          primary: { busy: [] },
          "gone@example.test": { errors: [{ reason: "notFound" }] },
        },
      },
    });
    await expect(freeBusy(host, FROM, TO)).rejects.toBeInstanceOf(GoogleApiError);
  });

  test("a calendar missing from the response fails closed", async () => {
    const host = await createHost({
      googleAccessToken: "tok",
      googleTokenExpiresAt: new Date(Date.now() + 3_600_000),
      conflictCalendarIds: ["silent@example.test"],
    });
    googleState.freebusyQuery.mockResolvedValue({ data: { calendars: { primary: { busy: [] } } } });
    await expect(freeBusy(host, FROM, TO)).rejects.toBeInstanceOf(GoogleApiError);
  });
});
