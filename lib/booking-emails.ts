import { DateTime } from "luxon";
import type { Booking, Host, MeetingType } from "@prisma/client";
import { appUrl } from "./env";
import { button, emailShell, escapeHtml, sendMail } from "./mailer";
import { formatPrice } from "./stripe";

export function formatWhen(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat(
    "cccc, LLLL d, yyyy 'at' h:mm a (ZZZZ)"
  );
}

export function cancelUrl(booking: Booking): string {
  return `${appUrl()}/cancel/${booking.cancelToken}`;
}

export async function sendBookingConfirmation(
  booking: Booking,
  meetingType: MeetingType,
  host: Host
): Promise<boolean> {
  const when = formatWhen(booking.startTime, booking.timezone);
  const meet = booking.meetLink;

  const html = emailShell(`
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a8a92">Confirmed</p>
    <h1 style="margin:0 0 16px;font-size:21px;color:#fff">${escapeHtml(meetingType.name)}</h1>
    <p style="margin:0 0 4px;color:#a5a5ad">When</p>
    <p style="margin:0 0 16px;font-size:16px;color:#fff"><strong>${escapeHtml(when)}</strong></p>
    <p style="margin:0 0 4px;color:#a5a5ad">Who</p>
    <p style="margin:0 0 20px">${escapeHtml(host.displayName || host.email)} &amp; ${escapeHtml(booking.name)}</p>
    ${meet ? `<p style="margin:0 0 20px">${button(meet, "Join Google Meet", meetingType.color)}</p>` : ""}
    <p style="margin:0 0 16px;color:#a5a5ad">A calendar invite is on its way from Google — accepting it puts the meeting on your calendar with the Meet link.</p>
    <p style="margin:24px 0 0;font-size:13px;color:#7a7a82">Need to change it? <a href="${cancelUrl(booking)}" style="color:#a5a5ad">Cancel this booking</a>.</p>
  `);

  const text = [
    `${meetingType.name} — confirmed`,
    "",
    `When: ${when}`,
    `Who: ${host.displayName || host.email} & ${booking.name}`,
    meet ? `Google Meet: ${meet}` : "",
    "",
    "A calendar invite is on its way from Google — accepting it puts the meeting on your calendar with the Meet link.",
    "",
    `Need to change it? Cancel here: ${cancelUrl(booking)}`,
  ]
    .filter(Boolean)
    .join("\n");

  return sendMail({
    to: booking.email,
    subject: `Confirmed: ${meetingType.name} — ${when}`,
    html,
    text,
    replyTo: host.email,
  });
}

export async function sendCancellationEmails(
  booking: Booking,
  meetingType: MeetingType,
  host: Host,
  cancelledBy: "booker" | "host"
): Promise<void> {
  const whenBooker = formatWhen(booking.startTime, booking.timezone);
  const whenHost = formatWhen(booking.startTime, host.timezone);
  const rebook = `${appUrl()}/${meetingType.slug}`;
  const paid = booking.stripePaymentStatus === "paid";

  await sendMail({
    to: booking.email,
    subject: `Cancelled: ${meetingType.name} — ${whenBooker}`,
    html: emailShell(`
      <h1 style="margin:0 0 14px;font-size:20px;color:#fff">Your booking was cancelled</h1>
      <p style="margin:0 0 6px;color:#a5a5ad">${escapeHtml(meetingType.name)}</p>
      <p style="margin:0 0 18px;font-size:16px;color:#fff"><s>${escapeHtml(whenBooker)}</s></p>
      <p style="margin:0 0 18px">The calendar event has been removed.</p>
      ${paid ? `<p style="margin:0 0 18px">You paid for this booking — reply to this email and ${escapeHtml(host.displayName || host.email)} will sort out a refund or a new time personally.</p>` : ""}
      <p style="margin:0 0 6px">${button(rebook, "Book another time", meetingType.color)}</p>
    `),
    text: [
      "Your booking was cancelled",
      "",
      `${meetingType.name}`,
      whenBooker,
      "",
      "The calendar event has been removed.",
      paid
        ? "You paid for this booking — reply to this email and it will be sorted out personally."
        : "",
      "",
      `Book another time: ${rebook}`,
    ]
      .filter(Boolean)
      .join("\n"),
    replyTo: host.email,
  });

  await sendMail({
    to: host.email,
    subject: `Cancelled: ${meetingType.name} with ${booking.name} — ${whenHost}`,
    html: emailShell(`
      <h1 style="margin:0 0 14px;font-size:20px;color:#fff">Booking cancelled${cancelledBy === "host" ? " (by you)" : ""}</h1>
      <p style="margin:0 0 6px">${escapeHtml(booking.name)} &lt;${escapeHtml(booking.email)}&gt;</p>
      <p style="margin:0 0 6px;color:#a5a5ad">${escapeHtml(meetingType.name)}</p>
      <p style="margin:0 0 18px;font-size:16px;color:#fff"><s>${escapeHtml(whenHost)}</s></p>
      ${paid ? `<p style="margin:0 0 6px;color:#ffb020"><strong>This booking was paid ${booking.amountCents ? formatPrice(booking.amountCents, meetingType.currency) : ""} — refund manually if appropriate.</strong></p>` : ""}
    `),
    text: [
      `Booking cancelled${cancelledBy === "host" ? " (by you)" : ""}`,
      `${booking.name} <${booking.email}>`,
      meetingType.name,
      whenHost,
      paid ? "PAID — refund manually if appropriate." : "",
    ]
      .filter(Boolean)
      .join("\n"),
    replyTo: booking.email,
  });
}

export async function sendConflictApology(
  booking: Booking,
  meetingType: MeetingType,
  host: Host,
  refunded: boolean
): Promise<void> {
  const when = formatWhen(booking.startTime, booking.timezone);
  const rebook = `${appUrl()}/${meetingType.slug}`;

  await sendMail({
    to: booking.email,
    subject: `Sorry — ${meetingType.name} on ${when} could not be confirmed`,
    html: emailShell(`
      <h1 style="margin:0 0 14px;font-size:20px;color:#fff">That slot got taken — you have been refunded</h1>
      <p style="margin:0 0 18px">Your payment went through at the exact moment ${escapeHtml(when)} was taken, so the booking could not be confirmed.</p>
      <p style="margin:0 0 18px">${refunded ? "A full refund is on its way back to your card and should land in 5–10 business days." : "A full refund is being processed manually and you will get a confirmation shortly."}</p>
      <p style="margin:0 0 6px">${button(rebook, "Pick another time", meetingType.color)}</p>
      <p style="margin:20px 0 0;font-size:13px;color:#7a7a82">Reply to this email if anything looks wrong.</p>
    `),
    text: [
      "That slot got taken — you have been refunded",
      "",
      `Your payment went through at the exact moment ${when} was taken, so the booking could not be confirmed.`,
      refunded
        ? "A full refund is on its way back to your card and should land in 5-10 business days."
        : "A full refund is being processed manually and you will get a confirmation shortly.",
      "",
      `Pick another time: ${rebook}`,
    ].join("\n"),
    replyTo: host.email,
  });
}

export async function sendManualFollowUpNotice(
  booking: Booking,
  meetingType: MeetingType,
  host: Host
): Promise<void> {
  const when = formatWhen(booking.startTime, booking.timezone);
  await sendMail({
    to: booking.email,
    subject: `Received: ${meetingType.name} — ${when}`,
    html: emailShell(`
      <h1 style="margin:0 0 14px;font-size:20px;color:#fff">Got your request — confirming by hand</h1>
      <p style="margin:0 0 18px">A calendar hiccup stopped the invite for <strong>${escapeHtml(when)}</strong> from going out automatically.</p>
      <p style="margin:0 0 18px">${escapeHtml(host.displayName || host.email)} has been alerted and will send the invite personally. Nothing else is needed from you.</p>
    `),
    text: [
      "Got your request — confirming by hand",
      "",
      `A calendar hiccup stopped the invite for ${when} from going out automatically.`,
      "You will get the invite personally shortly. Nothing else is needed from you.",
    ].join("\n"),
    replyTo: host.email,
  });
}
