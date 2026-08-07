/** Shared configuration for the end-to-end run. */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://bookkit:bookkit@localhost:5433/bookkit_e2e";

export const E2E_ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ??
  E2E_DATABASE_URL.replace(/\/[^/?]+(\?|$)/, "/postgres$1");

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${E2E_PORT}`;
export const E2E_ADMIN_PASSWORD = "e2e-admin-password";
