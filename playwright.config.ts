import { defineConfig, devices } from "@playwright/test";
import { E2E_ADMIN_PASSWORD, E2E_BASE_URL, E2E_DATABASE_URL, E2E_PORT } from "./tests/e2e/env";

/**
 * End-to-end tests run against a production build in demo mode, so they need no
 * Google credentials, no Stripe account, and no network — the in-memory calendar
 * backs every booking. That also means this run exercises the same code path the
 * hosted demo instance serves.
 *
 * Paid checkout is deliberately not covered here: demo mode refuses it so no
 * card can ever be touched. The paid state machine is covered by the integration
 * suite, and the live money path is verified by hand before a release.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/mobile\.spec\.ts/, /screenshots\.spec\.ts/],
    },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
    // Opt-in via `npm run screenshots`. Writes docs/screenshots/*.png rather
    // than asserting anything, so it stays out of the normal run and CI.
    ...(process.env.SCREENSHOTS
      ? [
          {
            name: "screenshots",
            use: { ...devices["Desktop Chrome"] },
            testMatch: /screenshots\.spec\.ts/,
          },
        ]
      : []),
  ],

  webServer: {
    command: "npm run build && npm run start -- --port " + E2E_PORT,
    url: E2E_BASE_URL,
    // Opt-in only. Reusing whatever happens to be on the port attaches to a
    // server built from different env — which reads as every page 404ing
    // against an empty database, with nothing to say why.
    reuseExistingServer: Boolean(process.env.E2E_REUSE_SERVER),
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      DIRECT_URL: E2E_DATABASE_URL,
      // Demo mode: in-memory calendar, paid bookings refused.
      BOOKKIT_DEMO_MODE: "1",
      ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
      ADMIN_EMAIL: "demo@bookkit.test",
      NEXT_PUBLIC_APP_URL: E2E_BASE_URL,
      // Nothing may reach the outside world.
      RESEND_API_KEY: "",
      RESEND_FROM: "",
      WEBHOOK_URL: "",
      STRIPE_SECRET_KEY: "",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      NODE_ENV: "production",
    },
  },
});
