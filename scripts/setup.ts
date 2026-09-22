/**
 * One command from clone to running:
 *
 *   npm run setup            interactive
 *   npm run setup -- --yes   accept defaults (local docker Postgres, generated password)
 *
 * Writes .env if missing, starts local Postgres when the URL points at the bundled
 * docker-compose database, applies migrations, seeds the first host / schedule /
 * brand / event type, and prints what is configured and what is still missing.
 * Safe to re-run: it never overwrites an existing .env value or existing data.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";

const YES = process.argv.includes("--yes") || !process.stdin.isTTY;
const LOCAL_DB = "postgresql://bookkit:bookkit@localhost:5433/bookkit";

function readEnv(): Record<string, string> {
  if (!existsSync(".env")) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function upsertEnv(key: string, value: string) {
  const current = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}="${value}"`;
  writeFileSync(".env", re.test(current) ? current.replace(re, line) : `${current.trimEnd()}\n${line}\n`);
}

async function reachable(url: string): Promise<boolean> {
  const { Client } = await import("pg");
  // Connect to the server's default db: the app db may not exist yet.
  const client = new Client({ connectionString: url.replace(/\/[^/?]+(\?|$)/, "/postgres$1"), connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

/** Create the app database on a local server if it doesn't exist yet. */
async function ensureDatabase(url: string) {
  if (!url.includes("localhost")) return;
  const name = new URL(url).pathname.slice(1);
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url.replace(/\/[^/?]+(\?|$)/, "/postgres$1") });
  try {
    await client.connect();
    const r = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!r.rowCount) await client.query(`CREATE DATABASE "${name.replace(/"/g, "")}"`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function run(cmd: string, env: Record<string, string> = {}) {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
}

async function main() {
  const rl = YES ? null : createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q: string, def: string) => {
    if (!rl) return def;
    const a = (await rl.question(`${q} [${def}]: `)).trim();
    return a || def;
  };

  console.log("\nBookKit setup\n");
  if (!existsSync(".env")) {
    writeFileSync(".env", readFileSync(".env.example", "utf8"));
    console.log("• created .env from .env.example");
  }
  const env = readEnv();

  const blank = (k: string) => !env[k] || env[k].startsWith("postgresql://user:") || env[k] === "change-me" || env[k] === "you@example.com";

  if (blank("DATABASE_URL")) {
    const url = await ask("Postgres URL (leave default to run one locally with docker)", LOCAL_DB);
    upsertEnv("DATABASE_URL", url);
    upsertEnv("DIRECT_URL", url);
    env.DATABASE_URL = env.DIRECT_URL = url;
  }
  if (blank("ADMIN_EMAIL")) {
    env.ADMIN_EMAIL = await ask("Your email (the Google account you'll connect)", "you@example.com");
    upsertEnv("ADMIN_EMAIL", env.ADMIN_EMAIL);
  }
  if (blank("ADMIN_PASSWORD")) {
    env.ADMIN_PASSWORD = await ask("Admin password", randomBytes(12).toString("base64url"));
    upsertEnv("ADMIN_PASSWORD", env.ADMIN_PASSWORD);
    console.log(`• admin password: ${env.ADMIN_PASSWORD}  (saved in .env)`);
  }
  if (!env.CRON_SECRET) {
    env.CRON_SECRET = randomBytes(24).toString("base64url");
    upsertEnv("CRON_SECRET", env.CRON_SECRET);
    console.log("• generated CRON_SECRET");
  }
  rl?.close();

  if (env.DATABASE_URL.includes("localhost:5433") && !(await reachable(env.DATABASE_URL))) {
    console.log("• starting local Postgres (docker compose)…");
    try {
      run("docker compose up -d --wait");
    } catch {
      console.error("\n✗ Could not start Postgres with docker. Start Docker (or colima) and re-run, or put a hosted Postgres URL in .env.");
      process.exit(1);
    }
  }

  await ensureDatabase(env.DATABASE_URL);
  console.log("• applying migrations…");
  run("npx prisma migrate deploy", { DATABASE_URL: env.DATABASE_URL, DIRECT_URL: env.DIRECT_URL || env.DATABASE_URL });
  console.log("• seeding…");
  run("npx tsx scripts/seed.ts", { ...env });

  const has = (k: string) => Boolean(env[k]?.trim());
  const rows: [string, boolean, string][] = [
    ["Google Calendar OAuth", has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET"), "required — README §3"],
    ["Email (Resend)", has("RESEND_API_KEY") && has("RESEND_FROM"), "recommended — confirmations, reminders, alerts"],
    ["Push alerts", has("ALERT_WEBHOOK_URL"), "optional — Slack / Discord / ntfy"],
    ["Stripe", has("STRIPE_SECRET_KEY") && has("STRIPE_WEBHOOK_SECRET"), "only for paid event types"],
  ];
  console.log("\nConfiguration:");
  for (const [name, ok, note] of rows) console.log(`  ${ok ? "✓" : "·"} ${name.padEnd(22)} ${ok ? "" : note}`);
  console.log(`
Next:
  npm run dev
  open http://localhost:3000/admin   (password in .env)
  → Settings → Connect Google Calendar
  → schedule ${"/api/cron/tick"} every 10 min (docs/RELIABILITY.md)
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
