/**
 * Environment for the integration suite.
 *
 * Vitest loads the developer's .env into process.env, and it re-applies it per
 * test file — so deleting a variable once at import time does not hold. Every
 * dangerous variable is therefore scrubbed again in a beforeEach (see
 * setup-integration.ts), which is the last write before a test body runs.
 *
 * This matters more than it looks: a real .env here holds a live Resend key and
 * a live Stripe key. Without the scrub the suite emails real people and creates
 * real PaymentIntents.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://bookkit:bookkit@localhost:5433/bookkit_test";

/** The admin server database, used only to create the test database. */
export const ADMIN_DATABASE_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  TEST_DATABASE_URL.replace(/\/[^/?]+(\?|$)/, "/postgres$1");

/** Anything that could reach the outside world, plus the safe values to use instead. */
const SAFE_ENV: Record<string, string | null> = {
  DATABASE_URL: TEST_DATABASE_URL,
  DIRECT_URL: TEST_DATABASE_URL,

  // Memory calendar — not demo mode, which would also refuse the paid bookings
  // that several of these tests exercise.
  BOOKKIT_CALENDAR: "memory",
  BOOKKIT_DEMO_MODE: null,

  // null => deleted. Email and outbound webhooks stay dark unless a test mocks them.
  RESEND_API_KEY: null,
  RESEND_FROM: null,
  ALERT_EMAIL: null,
  WEBHOOK_URL: null,
  ALERT_WEBHOOK_URL: null,
  // Webhook tests post to fake hostnames that don't resolve; the guard itself has unit tests.
  ALLOW_PRIVATE_WEBHOOKS: "1",
  CRON_SECRET: "test-cron-secret",
  VERCEL: null,
  TRUST_PROXY: null,
  WEBHOOK_SECRET: null,
  GOOGLE_CLIENT_ID: null,
  GOOGLE_CLIENT_SECRET: null,

  // Obvious fakes: stripeConfigured() reads true so the paid paths run, but the
  // Stripe client is mocked in every test that touches it and could not reach
  // the live API with these anyway.
  STRIPE_SECRET_KEY: "sk_test_bookkit_fake_do_not_use",
  STRIPE_WEBHOOK_SECRET: "whsec_bookkit_fake_do_not_use",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_bookkit_fake_do_not_use",

  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  ADMIN_PASSWORD: "test-admin-password",
  ADMIN_EMAIL: "host@example.test",
};

export function scrubEnv(): void {
  for (const [key, value] of Object.entries(SAFE_ENV)) {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
}

/**
 * Fails the run rather than let it touch anything real. Called after every
 * scrub, so a future change to .env or to Vitest's env handling surfaces as a
 * loud failure instead of a live send.
 */
export function assertNoLiveCredentials(): void {
  const resend = process.env.RESEND_API_KEY?.trim();
  if (resend) {
    throw new Error(
      `Refusing to run: RESEND_API_KEY is set (${resend.slice(0, 3)}…) — the suite would send real email.`
    );
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (stripeKey.includes("_live_")) {
    throw new Error("Refusing to run: STRIPE_SECRET_KEY is a LIVE key.");
  }

  if (process.env.ALERT_WEBHOOK_URL?.trim()) {
    throw new Error("Refusing to run: ALERT_WEBHOOK_URL is set — the suite would push real alerts.");
  }

  const webhook = process.env.WEBHOOK_URL?.trim();
  if (webhook) {
    throw new Error(`Refusing to run: WEBHOOK_URL is set (${webhook}) — the suite would POST to it.`);
  }

  const db = process.env.DATABASE_URL ?? "";
  if (!db.includes("bookkit_test")) {
    throw new Error(`Refusing to run: DATABASE_URL is not a test database (${db}).`);
  }
}

scrubEnv();
assertNoLiveCredentials();
