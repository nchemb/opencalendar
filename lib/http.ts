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

/** Best-effort client IP for rate limiting. */
export function clientIp(req: Request): string {
  const h = req.headers;
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip") || h.get("cf-connecting-ip") || "unknown";
}

export async function readJson<T = unknown>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
