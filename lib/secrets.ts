/**
 * Optional encryption at rest for Google OAuth tokens.
 *
 * With TOKEN_ENCRYPTION_KEY set (32 random bytes, base64 — `openssl rand -base64 32`),
 * tokens are stored as "enc:v1:<iv>:<tag>:<ciphertext>" (AES-256-GCM), so a leaked
 * database or backup does not hand out standing access to your calendar. Without it
 * they are stored as-is (v1 behaviour). Reading handles both, so turning the key on
 * later just encrypts on the next token write; reconnect Google to encrypt at once.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

const PREFIX = "enc:v1:";

function key(): Buffer | null {
  const raw = env("TOKEN_ENCRYPTION_KEY");
  if (!raw) return null;
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
  return k;
}

export function sealToken(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const k = key();
  if (!k) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${PREFIX}${iv.toString("base64url")}:${c.getAuthTag().toString("base64url")}:${ct.toString("base64url")}`;
}

export function openToken(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const k = key();
  if (!k) throw new Error("A stored Google token is encrypted but TOKEN_ENCRYPTION_KEY is not set.");
  const [iv, tag, ct] = stored.slice(PREFIX.length).split(":");
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
