import { prisma } from "./db";
import { env } from "./env";

/** Settings live in the DB when set from /admin, otherwise fall back to env. */
const ENV_BACKED = ["WEBHOOK_URL", "WEBHOOK_SECRET"] as const;
export type SettingKey = (typeof ENV_BACKED)[number];

export async function getSetting(key: SettingKey): Promise<string | undefined> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    const v = row?.value?.trim();
    if (v) return v;
  } catch {
    // table not migrated yet — fall through to env
  }
  return env(key);
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  const v = value.trim();
  await prisma.setting.upsert({
    where: { key },
    update: { value: v },
    create: { key, value: v },
  });
}

export async function allSettings(): Promise<Record<SettingKey, string>> {
  const rows = await prisma.setting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    WEBHOOK_URL: map.get("WEBHOOK_URL") ?? env("WEBHOOK_URL") ?? "",
    WEBHOOK_SECRET: map.get("WEBHOOK_SECRET") ?? env("WEBHOOK_SECRET") ?? "",
  };
}
