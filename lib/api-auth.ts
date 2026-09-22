/**
 * REST API v1 + MCP shared auth and response helpers.
 *
 * Auth: `Authorization: Bearer bk_live_...`. Keys are stored hashed (sha256) —
 * see prisma/schema.prisma `ApiKey`. `lastUsedAt` is throttled to at most once
 * a minute per key per instance so a busy key doesn't hammer the DB.
 *
 * Response shape is `{ ok, data | error, code }`, distinct from the rest of the
 * app's `{ ok, ...fields }` shape — this is the one the v1 API and MCP promise
 * external callers.
 */
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { ApiKey } from "@prisma/client";
import { prisma } from "./db";

const TOKEN_PREFIX = "bk_live_";
const LAST_USED_THROTTLE_MS = 60_000;

export function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mint a new key. Callers persist { name, prefix, hash } and show `token` to the user once. */
export function generateApiKey(name: string): { name: string; token: string; prefix: string; hash: string } {
  const token = TOKEN_PREFIX + randomBytes(24).toString("base64url");
  return { name, token, prefix: token.slice(0, TOKEN_PREFIX.length + 6), hash: hashApiKey(token) };
}

export type AuthedKey = Pick<ApiKey, "id" | "name">;

// ponytail: per-instance in-memory throttle map, fine for a single-region deploy;
// swap for a DB-side "only update if stale" query if this ever runs multi-region.
const lastUsedWrites = new Map<string, number>();

export async function authenticateApiKey(req: Request): Promise<AuthedKey | null> {
  const header = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(\S+)$/.exec(header);
  if (!m) return null;
  const token = m[1];
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const row = await prisma.apiKey.findUnique({ where: { hash: hashApiKey(token) } });
  if (!row || row.revokedAt) return null;

  const now = Date.now();
  const last = lastUsedWrites.get(row.id) ?? 0;
  if (now - last > LAST_USED_THROTTLE_MS) {
    lastUsedWrites.set(row.id, now);
    await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return { id: row.id, name: row.name };
}

export const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function corsPreflight(): Response {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function apiOk<T>(data: T, init?: ResponseInit): Response {
  return NextResponse.json({ ok: true, data }, { ...init, headers: { ...CORS_HEADERS, ...init?.headers } });
}

export function apiFail(error: string, status = 400, code?: string, extra?: Record<string, unknown>): Response {
  return NextResponse.json(
    { ok: false, error, ...(code ? { code } : {}), ...extra },
    { status, headers: CORS_HEADERS }
  );
}

/** Route guard: returns the authed key, or a 401 Response to return immediately. */
export async function requireApiKey(req: Request): Promise<{ key: AuthedKey } | { response: Response }> {
  const key = await authenticateApiKey(req);
  if (!key) return { response: apiFail("Missing or invalid API key. Use Authorization: Bearer bk_live_...", 401, "UNAUTHORIZED") };
  return { key };
}

/** Booking-engine errors -> the v1 {ok,error,code} shape (bookingErrorResponse returns the app's {ok,...} shape). */
export async function apiBookingErrorResponse(err: unknown): Promise<Response | null> {
  const { SlotTakenError, InvalidSlotError, BookingUnavailableError, ChangeNotAllowedError } = await import("./booking");
  const { GoogleApiError, GoogleAuthError } = await import("./calendar-types");
  if (err instanceof SlotTakenError) return apiFail(err.message, 409, err.code);
  if (err instanceof InvalidSlotError) return apiFail(err.message, 400, err.code);
  if (err instanceof BookingUnavailableError) return apiFail(err.message, 503, err.code);
  if (err instanceof ChangeNotAllowedError) return apiFail(err.message, 403, err.code);
  if (err instanceof GoogleAuthError) return apiFail("Booking is temporarily unavailable. Please try again later.", 503, "CALENDAR_DISCONNECTED");
  if (err instanceof GoogleApiError) return apiFail("Could not read the calendar just now. Please try again in a moment.", 503, "CALENDAR_UNREACHABLE");
  return null;
}
