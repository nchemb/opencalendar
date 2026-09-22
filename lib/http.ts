import { NextResponse } from "next/server";

export type ApiOk<T extends object = object> = { ok: true } & T;
export type ApiErr = { ok: false; error: string; code?: string };

export function ok<T extends object>(data?: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...(data ?? {}) }, init);
}

export function fail(error: string, status = 400, code?: string) {
  return NextResponse.json(
    { ok: false, error, ...(code ? { code } : {}) },
    { status }
  );
}

/**
 * Client IP for rate limiting.
 *
 * X-Forwarded-For is client-controlled unless a proxy you trust rewrites it. On
 * Vercel (and with TRUST_PROXY=1 behind your own proxy) the first entry is set by
 * the platform. Elsewhere we take the LAST entry — the one your nearest proxy
 * appended — so a spoofed header cannot mint a fresh rate-limit bucket.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const trusted = process.env.VERCEL === "1" || process.env.TRUST_PROXY === "1";
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((p) => p.trim()).filter(Boolean);
    const ip = trusted ? parts[0] : parts[parts.length - 1];
    if (ip) return ip;
  }
  return h.get("x-real-ip") || h.get("cf-connecting-ip") || "unknown";
}

export async function readJson<T = unknown>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/** Map booking-engine errors to HTTP responses. Unknown errors → null (caller decides). */
export async function bookingErrorResponse(err: unknown) {
  const { SlotTakenError, InvalidSlotError, BookingUnavailableError, ChangeNotAllowedError } = await import("./booking");
  const { GoogleApiError, GoogleAuthError } = await import("./calendar-types");
  if (err instanceof SlotTakenError) return fail(err.message, 409, err.code);
  if (err instanceof InvalidSlotError) return fail(err.message, 400, err.code);
  if (err instanceof BookingUnavailableError) return fail(err.message, 503, err.code);
  if (err instanceof ChangeNotAllowedError) return fail(err.message, 403, err.code);
  if (err instanceof GoogleAuthError)
    return fail("Booking is temporarily unavailable. Please try again later.", 503, "CALENDAR_DISCONNECTED");
  if (err instanceof GoogleApiError)
    return fail("Could not read the calendar just now. Please try again in a moment.", 503, "CALENDAR_UNREACHABLE");
  return null;
}
