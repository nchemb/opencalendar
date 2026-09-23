import { Resend } from "resend";
import { env } from "./env";
import { errorMessage, log } from "./logger";

let client: Resend | null = null;

function resend(): Resend | null {
  const key = env("RESEND_API_KEY");
  if (!key) return null;
  if (!client) client = new Resend(key);
  return client;
}

export type MailArgs = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Display name for the From header (e.g. the brand). The address stays RESEND_FROM's. */
  fromName?: string;
  attachments?: { filename: string; content: string; contentType?: string }[];
  /** Resend dedupes sends with the same key for 24h (outbox retries). */
  idempotencyKey?: string;
};

/** "Name <addr>" with the display name swapped, keeping the configured address. */
export function withFromName(from: string, name?: string): string {
  if (!name) return from;
  const addr = from.match(/<([^>]+)>/)?.[1] ?? from.trim();
  const safe = name.replace(/["<>\r\n]/g, "").slice(0, 60);
  return `"${safe}" <${addr}>`;
}

/**
 * Send via Resend. Never throws — email is a nice-to-have next to the Google invite.
 * Returns false when it did not send (unconfigured or failed).
 */
export async function sendMail(args: MailArgs): Promise<boolean> {
  const r = resend();
  const from = env("RESEND_FROM");

  if (!r || !from) {
    log.warn("mailer", "skipped_not_configured", { subject: args.subject });
    return false;
  }

  try {
    const res = await r.emails.send({
      from: withFromName(from, args.fromName),
      ...(args.attachments?.length
        ? {
            attachments: args.attachments.map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.content).toString("base64"),
              ...(a.contentType ? { contentType: a.contentType } : {}),
            })),
          }
        : {}),
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    }, args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined);
    // Same key, different body: an earlier attempt already sent this email.
    if (res.error?.name === "invalid_idempotent_request") {
      log.info("mailer", "already_sent", { subject: args.subject });
      return true;
    }
    if (res.error) {
      log.error("mailer", "send_failed", {
        subject: args.subject,
        error: res.error.message,
      });
      return false;
    }
    log.info("mailer", "sent", { subject: args.subject, id: res.data?.id });
    return true;
  } catch (err) {
    log.error("mailer", "send_threw", {
      subject: args.subject,
      error: errorMessage(err),
    });
    return false;
  }
}

/** Minimal, client-safe HTML shell. Light, readable in every mail client and in dark mode. */
export function emailShell(bodyHtml: string, footerHtml = ""): string {
  return `<!doctype html><html><head><meta name="color-scheme" content="light only"></head><body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:540px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:14px;padding:28px;color:#18181b;line-height:1.6;font-size:15px;">
    ${bodyHtml}
  </div>
  ${footerHtml ? `<div style="max-width:540px;margin:14px auto 0;color:#71717a;font-size:12px;line-height:1.5;text-align:center">${footerHtml}</div>` : ""}
</body></html>`;
}

export function button(href: string, label: string, color = "#18181b"): string {
  return `<a href="${href}" style="display:inline-block;background:${color};color:${readableOn(color)};font-weight:600;text-decoration:none;padding:11px 18px;border-radius:9px;">${escapeHtml(label)}</a>`;
}

/** Black or white text, whichever reads better on the given hex background. */
export function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#111111" : "#ffffff";
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
