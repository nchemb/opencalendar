/**
 * Admin-issued API keys for the REST API (lib/types I2). Only the sha256 hash is
 * stored; the plaintext is shown exactly once, on creation.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../db";

const PREFIX = "bk_live_";

export function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export async function createApiKey(name: string): Promise<{ id: string; plaintext: string }> {
  const plaintext = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  const row = await prisma.apiKey.create({
    data: { name, prefix: plaintext.slice(0, 12), hash: hashKey(plaintext) },
  });
  return { id: row.id, plaintext };
}

export async function revokeApiKey(id: string): Promise<void> {
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
}

/** Verify a bearer key from a request and mark it used. null when invalid/revoked. */
export async function verifyApiKey(plaintext: string | null): Promise<{ id: string; name: string } | null> {
  if (!plaintext || !plaintext.startsWith(PREFIX)) return null;
  const hash = hashKey(plaintext);
  const key = await prisma.apiKey.findUnique({ where: { hash } });
  if (!key || key.revokedAt) return null;
  // Constant-time compare against the just-computed hash (defense in depth; the
  // unique lookup above already pins us to the one matching row).
  const stored = Buffer.from(key.hash);
  const given = Buffer.from(hash);
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) return null;
  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { id: key.id, name: key.name };
}
