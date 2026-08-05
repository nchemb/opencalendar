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
};

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
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    });
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

/** Minimal, client-safe HTML shell. Paragraphs only — never hard-wrap mid-paragraph. */
export function emailShell(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#0b0b0c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#141416;border:1px solid #26262a;border-radius:14px;padding:28px;color:#e8e8ea;line-height:1.6;font-size:15px;">
    ${bodyHtml}
  </div>
</body></html>`;
}

export function button(href: string, label: string, color = "#FF6A00"): string {
  return `<a href="${href}" style="display:inline-block;background:${color};color:#0b0b0c;font-weight:600;text-decoration:none;padding:11px 18px;border-radius:9px;">${label}</a>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
