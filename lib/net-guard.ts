/**
 * Outbound-request guard for user-configured URLs (webhook endpoints).
 *
 * Blocks loopback, private, link-local (incl. cloud metadata 169.254.169.254),
 * CGNAT and unique-local addresses after DNS resolution, so a webhook URL can't
 * be pointed at the server's own network. Local development may opt out with
 * ALLOW_PRIVATE_WEBHOOKS=1 (never set it in production).
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env } from "./env";

export class BlockedUrlError extends Error {}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function privateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) return privateV4(v.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}

export function isPrivateAddress(ip: string): boolean {
  return isIP(ip) === 4 ? privateV4(ip) : isIP(ip) === 6 ? privateV6(ip) : true;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("Not a valid URL.");
  }
  const allowPrivate = env("ALLOW_PRIVATE_WEBHOOKS") === "1";
  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:")) {
    throw new BlockedUrlError("Webhook URLs must use https.");
  }
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new BlockedUrlError(`Could not resolve ${host}.`);
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    throw new BlockedUrlError("Webhook URLs may not point at private or internal addresses.");
  }
  return url;
}
