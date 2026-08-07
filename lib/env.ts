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
 * Demo mode: calendar writes go to an in-memory fake instead of real Google
 * Calendar, paid meeting types are refused, and public pages carry a banner.
 * Powers the hosted demo instance and the test suite. Never set this on a real
 * deployment — bookings would never reach anybody's calendar.
 */
export const isDemoMode = () => env("BOOKKIT_DEMO_MODE") === "1";

export const hasStripe = () => Boolean(env("STRIPE_SECRET_KEY"));
export const hasResend = () => Boolean(env("RESEND_API_KEY"));
export const hasGoogleOAuth = () =>
  Boolean(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));

export function googleRedirectUri(): string {
  return env("GOOGLE_REDIRECT_URI") || `${appUrl()}/api/google/callback`;
}
