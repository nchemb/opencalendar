import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { env } from "./env";

const COOKIE = "bookkit_admin";
const MAX_AGE_SEC = 60 * 60 * 24 * 14; // 14 days

function secret(): string | undefined {
  return env("ADMIN_PASSWORD");
}

function sign(expiresAt: number, key: string): string {
  return createHmac("sha256", key).update(`admin.${expiresAt}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function checkPassword(candidate: unknown): boolean {
  const key = secret();
  if (!key || typeof candidate !== "string") return false;
  // Hash both sides so length never leaks and comparison stays constant time.
  const h = (v: string) => createHmac("sha256", "bookkit-login").update(v).digest("hex");
  return safeEqual(h(candidate), h(key));
}

export function issueSessionCookie() {
  const key = secret();
  if (!key) throw new Error("ADMIN_PASSWORD is not set");
  const expiresAt = Date.now() + MAX_AGE_SEC * 1000;
  cookies().set(COOKIE, `${expiresAt}.${sign(expiresAt, key)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

export function clearSessionCookie() {
  cookies().set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export function isAdmin(): boolean {
  const key = secret();
  if (!key) return false;

  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return false;

  const [expiresRaw, sig] = raw.split(".");
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !sig) return false;

  return safeEqual(sig, sign(expiresAt, key));
}

/** Throwing guard for admin API routes. */
export function assertAdmin(): void {
  if (!isAdmin()) {
    const err = new Error("Not authorized") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
}
