import { DateTime } from "luxon";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL_RE.test(value.trim());
}

export function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  return v.slice(0, max);
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  return DateTime.local().setZone(tz).isValid;
}

export function isSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

/** Parses an ISO instant. Returns null unless it is a real, whole-minute time. */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const dt = DateTime.fromISO(value, { setZone: true });
  if (!dt.isValid) return null;
  const js = dt.toUTC().toJSDate();
  if (js.getUTCSeconds() !== 0 || js.getUTCMilliseconds() !== 0) return null;
  return js;
}

/** Honeypot + minimum fill time — cheap bot filter on public forms. */
export function looksLikeBot(body: Record<string, unknown>): boolean {
  if (cleanString(body.company, 100)) return true; // honeypot field
  const elapsed = Number(body.elapsedMs);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 1500) return true;
  return false;
}
