/**
 * Host alerts.
 *
 * Every alert is first a DB row (the admin shows open alerts as a banner and
 * /api/health reports them), then a best-effort push: email via the mailer and,
 * if ALERT_WEBHOOK_URL is set, a POST to Slack / Discord / ntfy / anything.
 * A missing mail provider can make an alert quieter, never invisible.
 */
import type { Booking, Host } from "@prisma/client";
import { prisma } from "./db";
import { appUrl, env } from "./env";
import { errorMessage, log } from "./logger";
import { emailShell, escapeHtml, sendMail } from "./mailer";

export type Severity = "critical" | "warning" | "info";

export type AlertInput = {
  kind: string;
  severity: Severity;
  title: string;
  /** Plain text. Rendered escaped in email and the admin. */
  message: string;
  bookingId?: string | null;
  /** Dedupe key while the alert is open. Defaults to kind (+ bookingId). */
  key?: string;
  /** Link for the host to act on. */
  cta?: string;
};

/** Re-notify an alert that is still open at most this often. */
const RENOTIFY_MS = 6 * 3_600_000;

function recipient(host?: Pick<Host, "email"> | null): string | null {
  return env("ALERT_EMAIL") || env("ADMIN_EMAIL") || host?.email || null;
}

export async function raiseAlert(input: AlertInput, host?: Pick<Host, "email"> | null): Promise<void> {
  const openKey = input.key ?? (input.bookingId ? `${input.kind}:${input.bookingId}` : input.kind);
  let row: { id: string; notifiedAt: Date | null } | null = null;
  try {
    row = await prisma.alert.upsert({
      where: { openKey },
      create: {
        kind: input.kind,
        severity: input.severity,
        title: input.title,
        message: input.message.slice(0, 4000),
        bookingId: input.bookingId ?? null,
        openKey,
      },
      update: {
        count: { increment: 1 },
        lastSeenAt: new Date(),
        message: input.message.slice(0, 4000),
        severity: input.severity,
      },
      select: { id: true, notifiedAt: true },
    });
  } catch (err) {
    log.error("alerts", "persist_failed", { kind: input.kind, error: errorMessage(err) });
  }

  (input.severity === "info" ? log.info : log.error)("alerts", "raised", {
    kind: input.kind,
    title: input.title,
    bookingId: input.bookingId,
  });

  if (row?.notifiedAt && Date.now() - row.notifiedAt.getTime() < RENOTIFY_MS) return;

  const errors: string[] = [];
  const sent = await notifyEmail(input, host).catch((e) => {
    errors.push(`email: ${errorMessage(e)}`);
    return false;
  });
  if (!sent && !errors.length) errors.push("email: not delivered (mail not configured or failed)");
  const pushed = await notifyWebhook(input).catch((e) => {
    errors.push(`push: ${errorMessage(e)}`);
    return false;
  });

  if (row) {
    await prisma.alert
      .update({
        where: { id: row.id },
        data: {
          notifiedAt: sent || pushed ? new Date() : row.notifiedAt,
          notifyError: sent || pushed ? null : errors.join("; ").slice(0, 500),
        },
      })
      .catch(() => undefined);
  }
}

/** Close an open alert (e.g. Google reconnected). The next occurrence opens a fresh one. */
export async function resolveAlert(key: string): Promise<void> {
  await prisma.alert
    .updateMany({ where: { openKey: key }, data: { openKey: null, resolvedAt: new Date() } })
    .catch(() => undefined);
}

export async function resolveAlertById(id: string): Promise<void> {
  await prisma.alert.update({ where: { id }, data: { openKey: null, resolvedAt: new Date() } });
}

export async function openAlerts() {
  return prisma.alert.findMany({
    where: { resolvedAt: null },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });
}

async function notifyEmail(input: AlertInput, host?: Pick<Host, "email"> | null): Promise<boolean> {
  const to = recipient(host);
  if (!to) return false;
  const tag =
    input.severity === "critical" ? "[CRITICAL]" : input.severity === "warning" ? "[ACTION]" : "[INFO]";
  const cta = input.cta ?? `${appUrl()}/admin`;
  return sendMail({
    to,
    subject: `${tag} BookKit — ${input.title}`,
    html: emailShell(
      `<h2 style="margin:0 0 14px;font-size:17px;color:${input.severity === "critical" ? "#d92d20" : "#b54708"}">${escapeHtml(input.title)}</h2>` +
        input.message
          .split("\n")
          .map((l) => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`)
          .join("") +
        `<p style="margin:16px 0 0"><a href="${cta}">${cta}</a></p>`
    ),
    text: [input.title, "", input.message, "", cta].join("\n"),
  });
}

/**
 * Push to a chat/notification webhook. Shape is picked from the URL so one env
 * var works for Slack, Discord and ntfy; anything else gets generic JSON.
 */
async function notifyWebhook(input: AlertInput): Promise<boolean> {
  const url = env("ALERT_WEBHOOK_URL");
  if (!url) return false;
  const cta = input.cta ?? `${appUrl()}/admin`;
  const text = `${input.severity === "critical" ? "🚨" : "⚠️"} BookKit: ${input.title}\n${input.message}\n${cta}`;
  let init: RequestInit;
  if (url.includes("hooks.slack.com")) {
    init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) };
  } else if (url.includes("discord.com/api/webhooks") || url.includes("discordapp.com/api/webhooks")) {
    init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 1900) }),
    };
  } else if (url.includes("ntfy")) {
    init = {
      method: "POST",
      headers: {
        Title: `BookKit: ${input.title}`.replace(/[^\x20-\x7E]/g, ""),
        Priority: input.severity === "critical" ? "5" : "4",
        Click: cta,
      },
      body: input.message,
    };
  } else {
    init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, cta, text }),
    };
  }
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`alert webhook returned ${res.status}`);
  return true;
}

// ---------------------------------------------------------------------------
// Named alerts used across the app
// ---------------------------------------------------------------------------

function who(b: Booking) {
  return `${b.name} <${b.email}>`;
}

export async function sendGoogleDisconnectedAlert(host: Host, reason: string) {
  await raiseAlert(
    {
      kind: "google_disconnected",
      severity: "critical",
      title: "Google Calendar disconnected, new bookings are blocked",
      message: `Google rejected the calendar connection. Booking pages show a "temporarily unavailable" message until you reconnect.\nReason: ${reason.slice(0, 300)}`,
      cta: `${appUrl()}/admin/settings`,
    },
    host
  );
}

export async function sendCalendarPendingAlert(booking: Booking, host: Host | null, reason: string) {
  const paid = booking.stripePaymentStatus === "paid";
  await raiseAlert(
    {
      kind: "calendar_pending",
      severity: "critical",
      title: `A booking is confirmed but not on your calendar yet${paid ? " (paid)" : ""}`,
      message: `${who(booking)} booked ${booking.startTime.toISOString()} (UTC). The calendar write failed and is retrying automatically. If retries keep failing, add it by hand.\nError: ${reason.slice(0, 300)}`,
      bookingId: booking.id,
      cta: `${appUrl()}/admin/bookings/${booking.id}`,
    },
    host
  );
}

export async function sendConflictRefundAlert(
  booking: Booking,
  host: Host | null,
  refunded: boolean,
  detail: string
) {
  await raiseAlert(
    {
      kind: "paid_conflict",
      severity: "critical",
      title: "A paid booking hit a slot conflict",
      message: `${who(booking)} paid for ${booking.startTime.toISOString()} (UTC) but the slot had been taken.\n${
        refunded
          ? "A full refund was issued automatically and they were emailed."
          : "The automatic refund FAILED. Refund this payment in Stripe."
      }\nDetail: ${detail.slice(0, 300)}`,
      bookingId: booking.id,
      cta: `${appUrl()}/admin/bookings/${booking.id}`,
    },
    host
  );
}

export async function sendWebhookSignatureAlert(reason: string) {
  await raiseAlert({
    kind: "stripe_signature",
    severity: "warning",
    title: "Stripe webhook signature failed",
    message: `A request to the Stripe webhook failed signature verification. If you are not mid-deploy, check STRIPE_WEBHOOK_SECRET.\nError: ${reason.slice(0, 300)}`,
  });
}
