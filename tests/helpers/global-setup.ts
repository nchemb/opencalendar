/**
 * Runs once before the integration suite: waits for Postgres, creates the test
 * database if it is missing, and applies migrations.
 *
 * Locally that server is the docker-compose one (`docker compose up -d`).
 * In CI it is the workflow's Postgres service container.
 */
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { ADMIN_DATABASE_URL, TEST_DATABASE_URL } from "./test-env";

const testDbName = new URL(TEST_DATABASE_URL).pathname.slice(1);

async function waitForServer(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;

  while (Date.now() < deadline) {
    const client = new Client({ connectionString: ADMIN_DATABASE_URL });
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
    `Postgres was not reachable at ${ADMIN_DATABASE_URL} within ${timeoutMs}ms. ` +
      `Start it with \`docker compose up -d\`.\nLast error: ${String(lastErr)}`
  );
}

async function ensureDatabase(): Promise<void> {
  const client = new Client({ connectionString: ADMIN_DATABASE_URL });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      testDbName,
    ]);
    if (!rowCount) {
      // Identifier cannot be parameterised; testDbName comes from our own env, not user input.
      await client.query(`CREATE DATABASE "${testDbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
}

export default async function setup(): Promise<void> {
  await waitForServer();
  await ensureDatabase();

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      DIRECT_URL: TEST_DATABASE_URL,
    },
  });
}
