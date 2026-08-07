/**
 * Prepares the end-to-end database: waits for Postgres, creates bookkit_e2e if
 * it is missing, migrates it, and seeds the demo host and meeting types.
 */
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { E2E_DATABASE_URL, E2E_ADMIN_DATABASE_URL } from "./env";

const dbName = new URL(E2E_DATABASE_URL).pathname.slice(1);

async function waitForServer(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;

  while (Date.now() < deadline) {
    const client = new Client({ connectionString: E2E_ADMIN_DATABASE_URL });
    try {
      await client.connect();
      await client.end();
      return;
    } catch (err) {
      lastErr = err;
      await client.end().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  throw new Error(
    `Postgres was not reachable at ${E2E_ADMIN_DATABASE_URL}. Start it with \`docker compose up -d\`.\n` +
      `Last error: ${String(lastErr)}`
  );
}

export default async function globalSetup(): Promise<void> {
  await waitForServer();

  const admin = new Client({ connectionString: E2E_ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await admin.end();
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, DIRECT_URL: E2E_DATABASE_URL },
  });

  // Seed in a child process so it picks up the e2e DATABASE_URL cleanly.
  execFileSync("npx", ["tsx", "tests/e2e/seed-e2e.ts"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, DIRECT_URL: E2E_DATABASE_URL },
  });
}
