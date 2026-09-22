import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { env } from "./env";
import { prisma } from "./db";

const COOKIE = "bookkit_admin";
const MAX_AGE_SEC = 60 * 60 * 24 * 14; // 14 days

function secret(): string | undefined {
  return env("ADMIN_PASSWORD");
}

function sign(expiresAt: number, version: number, key: string): string {
  return createHmac("sha256", key).update(`admin.${expiresAt}.${version}`).digest("hex");
}

/** Bumping the host's sessionVersion invalidates every issued admin cookie. */
async function currentVersion(): Promise<number> {
  const host = await prisma.host.findFirst({ orderBy: { createdAt: "asc" }, select: { sessionVersion: true } });
  return host?.sessionVersion ?? 1;
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

export async function issueSessionCookie() {
  const key = secret();
  if (!key) throw new Error("ADMIN_PASSWORD is not set");
  const expiresAt = Date.now() + MAX_AGE_SEC * 1000;
  const version = await currentVersion();
  cookies().set(COOKIE, `${expiresAt}.${version}.${sign(expiresAt, version, key)}`, {
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

/**
 * Async on purpose: the session version lives in the DB. The old sync `isAdmin()`
 * is gone so a forgotten `await` cannot silently pass as truthy.
 */
export async function adminSession(): Promise<boolean> {
  const key = secret();
  if (!key) return false;

  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return false;

  const [expiresRaw, versionRaw, sig] = raw.split(".");
  const expiresAt = Number(expiresRaw);
  const version = Number(versionRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !Number.isInteger(version) || !sig) return false;
  if (!safeEqual(sig, sign(expiresAt, version, key))) return false;
  return version === (await currentVersion());
}

/** Sign out every device. */
export async function revokeAllSessions(): Promise<void> {
  const host = await prisma.host.findFirst({ orderBy: { createdAt: "asc" } });
  if (host) await prisma.host.update({ where: { id: host.id }, data: { sessionVersion: { increment: 1 } } });
}
