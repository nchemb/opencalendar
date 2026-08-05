import type { Booking, Host, MeetingType } from "@prisma/client";
import { appUrl, env } from "./env";
import { log } from "./logger";
import { emailShell, escapeHtml, sendMail } from "./mailer";

function alertRecipient(host?: Host | null): string | null {
  return env("ALERT_EMAIL") || env("ADMIN_EMAIL") || host?.email || null;
}

async function alert(host: Host | null, subject: string, lines: string[], cta?: string) {
  const to = alertRecipient(host);
  if (!to) {
    log.error("alerts", "no_recipient", { subject });
    return;
  }
  const body = lines.map((l) => `<p style="margin:0 0 10px">${l}</p>`).join("");
  await sendMail({
    to,
    subject,
    html: emailShell(
      `<h2 style="margin:0 0 14px;font-size:17px;color:#ff5c5c">${escapeHtml(subject)}</h2>${body}${
        cta ? `<p style="margin:16px 0 0"><a href="${cta}" style="color:#FF6A00">${cta}</a></p>` : ""
      }`
    ),
    text: [subject, "", ...lines.map(stripTags), cta ?? ""].join("\n"),
  });
}

function stripTags(s: string) {
  return s.replace(/<[^>]+>/g, "");
}

function when(b: Booking) {
  return `${b.startTime.toISOString()} → ${b.endTime.toISOString()} (UTC)`;
}

export async function sendGoogleDisconnectedAlert(host: Host, reason: string) {
  await alert(
    host,
    "[URGENT] BookKit — Google Calendar disconnected",
    [
      "Your Google Calendar connection was rejected. <strong>All new bookings are blocked</strong> until you reconnect.",
      `Reason: <code>${escapeHtml(reason.slice(0, 300))}</code>`,
      "Booking pages are showing the fallback 'email me' message in the meantime.",
    ],
    `${appUrl()}/admin/settings`
  );
}

export async function sendCalendarFailureAlert(
  booking: Booking & { meetingType?: MeetingType | null },
  host: Host | null,
  reason: string
) {
  const paid = booking.stripePaymentStatus === "paid";
  await alert(
    host,
    `[CRITICAL] BookKit — calendar event failed${paid ? " AFTER PAYMENT" : ""}`,
    [
      `Booking <code>${booking.id}</code> could not be written to Google Calendar after retries.`,
      paid
        ? "<strong>The booker has already paid.</strong> Create the event manually or refund them."
        : "No payment was taken. The booker was told you would confirm manually.",
      `Booker: ${escapeHtml(booking.name)} &lt;${escapeHtml(booking.email)}&gt;`,
      `Time: ${when(booking)}`,
      `Error: <code>${escapeHtml(reason.slice(0, 300))}</code>`,
    ],
    `${appUrl()}/admin/bookings`
  );
}

export async function sendConflictRefundAlert(
  booking: Booking,
  host: Host | null,
  refunded: boolean,
  detail: string
) {
  await alert(
    host,
    "[CRITICAL] BookKit — paid booking hit a slot conflict",
    [
      `Booking <code>${booking.id}</code> was paid but the slot had been taken.`,
      refunded
        ? "A full refund was issued automatically and the booker was emailed an apology."
        : "<strong>The automatic refund FAILED.</strong> Refund this payment manually in Stripe.",
      `Booker: ${escapeHtml(booking.name)} &lt;${escapeHtml(booking.email)}&gt;`,
      `Time: ${when(booking)}`,
      `Detail: <code>${escapeHtml(detail.slice(0, 300))}</code>`,
    ],
    `${appUrl()}/admin/bookings`
  );
}

export async function sendWebhookSignatureAlert(reason: string) {
  await alert(
    null,
    "[SECURITY] BookKit — Stripe webhook signature failed",
    [
      "A request to the Stripe webhook failed signature verification.",
      "If you are not mid-deploy, check that STRIPE_WEBHOOK_SECRET matches the endpoint in the Stripe dashboard.",
      `Error: <code>${escapeHtml(reason.slice(0, 300))}</code>`,
    ]
  );
}
