/** Trimmed env access. Trailing whitespace on a hosted env var is a classic silent-401 source. */
export function env(key: string): string | undefined {
  const raw = process.env[key];
  if (raw == null) return undefined;
  const v = raw.trim();
  return v.length ? v : undefined;
}

export function requireEnv(key: string): string {
  const v = env(key);
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export function appUrl(): string {
  const explicit = env("NEXT_PUBLIC_APP_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = env("VERCEL_URL");
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/**
 * Which calendar backend to use. "google" is the only real one; "memory" is an
 * in-process fake that the test suite and the hosted demo book against. Demo
 * mode implies memory — a demo must never write to a real calendar.
 */
export function calendarBackend(): "google" | "memory" {
  if (isDemoMode()) return "memory";
  return env("BOOKKIT_CALENDAR") === "memory" ? "memory" : "google";
}

/**
 * Demo mode: the hosted, publicly bookable instance. Implies the memory
 * calendar, refuses paid meeting types so no real card is ever charged, and
 * makes public pages carry a "resets daily" banner. Never set this on a real
 * deployment — bookings would not reach anybody's calendar.
 */
export const isDemoMode = () => env("BOOKKIT_DEMO_MODE") === "1";

export const hasStripe = () => Boolean(env("STRIPE_SECRET_KEY"));
export const hasResend = () => Boolean(env("RESEND_API_KEY"));
export const hasGoogleOAuth = () =>
  Boolean(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));

export function googleRedirectUri(): string {
  return env("GOOGLE_REDIRECT_URI") || `${appUrl()}/api/google/callback`;
}
