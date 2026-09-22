/**
 * Admin authentication. The whole dashboard sits behind one signed cookie, so
 * these are the tests that matter most for a self-hosted instance exposed to the
 * internet: a forged or extended cookie must not get in.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

/** In-memory stand-in for Next's cookie store. */
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

import {
  adminSession,
  checkPassword,
  clearSessionCookie,
  issueSessionCookie,
  revokeAllSessions,
} from "../../lib/auth";
import { createHost } from "../helpers/factories";
import {
  DELETE as logout,
  GET as sessionStatus,
  POST as login,
} from "../../app/api/admin/session/route";
import { POST as createMeetingTypeRoute } from "../../app/api/admin/event-types/route";

const COOKIE = "bookkit_admin";
const PASSWORD = "test-admin-password";

function sign(expiresAt: number, key = PASSWORD, version = 1): string {
  return createHmac("sha256", key).update(`admin.${expiresAt}.${version}`).digest("hex");
}

function cookie(expiresAt: number, sig: string, version = 1) {
  return `${expiresAt}.${version}.${sig}`;
}

async function json(res: Response) {
  return (await res.json()) as { ok: boolean; authenticated?: boolean; code?: string };
}

let ipSeq = 0;
function loginRequest(password: unknown) {
  return new Request("http://localhost:3000/api/admin/session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${++ipSeq % 250}` },
    body: JSON.stringify({ password }),
  });
}

beforeEach(() => {
  jar.clear();
});

describe("password check", () => {
  test("accepts the configured password", () => {
    expect(checkPassword(PASSWORD)).toBe(true);
  });

  test("rejects a wrong password, a prefix, and non-strings", () => {
    expect(checkPassword("wrong")).toBe(false);
    expect(checkPassword(PASSWORD.slice(0, -1))).toBe(false);
    expect(checkPassword(PASSWORD + "x")).toBe(false);
    expect(checkPassword(undefined)).toBe(false);
    expect(checkPassword(null)).toBe(false);
    expect(checkPassword(123)).toBe(false);
    expect(checkPassword({ toString: () => PASSWORD })).toBe(false);
  });
});

describe("session cookie", () => {
  test("a freshly issued cookie authenticates", async () => {
    await createHost();
    expect(await adminSession()).toBe(false);
    await issueSessionCookie();
    expect(await adminSession()).toBe(true);
  });

  test("logging out clears the session", async () => {
    await issueSessionCookie();
    clearSessionCookie();
    expect(await adminSession()).toBe(false);
  });

  test("signing out everywhere revokes cookies already issued", async () => {
    await createHost();
    await issueSessionCookie();
    const stolen = jar.get(COOKIE)!;
    await revokeAllSessions();
    jar.set(COOKIE, stolen);
    expect(await adminSession()).toBe(false);
  });

  test("a cookie signed with the wrong key is rejected", async () => {
    const expiresAt = Date.now() + 60_000;
    jar.set(COOKIE, cookie(expiresAt, sign(expiresAt, "guessed-password")));
    expect(await adminSession()).toBe(false);
  });

  test("an expired cookie is rejected even with a valid signature", async () => {
    const expiresAt = Date.now() - 1_000;
    jar.set(COOKIE, cookie(expiresAt, sign(expiresAt)));
    expect(await adminSession()).toBe(false);
  });

  test("extending the expiry invalidates the signature", async () => {
    const realExpiry = Date.now() + 60_000;
    const signature = sign(realExpiry);
    // Attacker keeps the signature but pushes the expiry out a year.
    jar.set(COOKIE, cookie(realExpiry + 365 * 86_400_000, signature));
    expect(await adminSession()).toBe(false);
  });

  test("bumping the version in the cookie invalidates the signature", async () => {
    const expiresAt = Date.now() + 60_000;
    jar.set(COOKIE, cookie(expiresAt, sign(expiresAt, PASSWORD, 1), 2));
    expect(await adminSession()).toBe(false);
  });

  test("malformed cookie values are rejected, not crashed on", async () => {
    for (const value of ["", ".", "abc", "abc.def", "123", `${Date.now() + 1000}.`, "...", `${Date.now() + 1000}.x.y`]) {
      jar.set(COOKIE, value);
      expect(await adminSession()).toBe(false);
    }
  });
});

describe("POST /api/admin/session", () => {
  test("the right password logs in and sets the cookie", async () => {
    const res = await login(loginRequest(PASSWORD));
    expect(res.status).toBe(200);
    expect(await json(res).then((b) => b.authenticated)).toBe(true);
    expect(jar.has(COOKIE)).toBe(true);
  });

  test("the wrong password is a 401 and sets nothing", async () => {
    const res = await login(loginRequest("hunter2"));
    expect(res.status).toBe(401);
    expect(await json(res).then((b) => b.code)).toBe("BAD_PASSWORD");
    expect(jar.has(COOKIE)).toBe(false);
  });

  test("GET reports the current state, and DELETE logs out", async () => {
    const del = () => logout(new Request("http://localhost:3000/api/admin/session", { method: "DELETE" }));
    expect(await sessionStatus().then(json).then((b) => b.authenticated)).toBe(false);

    await login(loginRequest(PASSWORD));
    expect(await sessionStatus().then(json).then((b) => b.authenticated)).toBe(true);

    await del();
    expect(await sessionStatus().then(json).then((b) => b.authenticated)).toBe(false);
  });

  test("repeated wrong guesses hit the rate limiter", async () => {
    const ip = "192.0.2.250";
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) {
      const res = await login(
        new Request("http://localhost:3000/api/admin/session", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify({ password: `guess-${i}` }),
        })
      );
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});

describe("admin API routes reject anonymous callers", () => {
  function createRequest() {
    return new Request("http://localhost:3000/api/admin/event-types", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "sneaky", name: "Sneaky", durationMinutes: 30 }),
    });
  }

  test("without a session cookie the write is refused", async () => {
    const res = await createMeetingTypeRoute(createRequest());
    expect(res.status).toBe(401);
    expect(await json(res).then((b) => b.code)).toBe("UNAUTHORIZED");
  });

  test("with a forged cookie the write is still refused", async () => {
    const expiresAt = Date.now() + 86_400_000;
    jar.set(COOKIE, cookie(expiresAt, sign(expiresAt, "not-the-password")));

    const res = await createMeetingTypeRoute(createRequest());
    expect(res.status).toBe(401);
  });
});
