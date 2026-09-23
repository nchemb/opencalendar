/**
 * Every email OpenCalendar sends about a booking. Plain functions that render and send;
 * callers run them through the outbox (lib/job-handlers.ts) so a failed send is
 * retried rather than lost.
 */
import { DateTime } from "luxon";
import type { Booking, Brand, Host, MeetingType } from "@prisma/client";
import { appUrl } from "./env";
import { button, emailShell, escapeHtml, sendMail } from "./mailer";
import { formatPrice } from "./stripe";
import { buildIcs, googleCalendarLink, outlookCalendarLink, type CalendarItem } from "./ics";
import { locationLabel, type LocationOption } from "./types";

export type BookingCtx = {
  booking: Booking;
  meetingType: MeetingType & { brand?: Brand | null };
  host: Host;
  /** Set by the outbox: provider idempotency key, so a retried job never mails twice. */
  mailKey?: string;
};

export function formatWhen(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat("cccc, LLLL d, yyyy 'at' h:mm a (ZZZZ)");
}

export function manageUrl(b: Pick<Booking, "cancelToken">): string {
  return `${appUrl()}/booking/${b.cancelToken}`;
}
export const rescheduleUrl = (b: Pick<Booking, "cancelToken">) => `${manageUrl(b)}?action=reschedule`;
export const cancelUrl = (b: Pick<Booking, "cancelToken">) => `${manageUrl(b)}?action=cancel`;
export const icsUrl = (b: Pick<Booking, "cancelToken">) => `${appUrl()}/api/bookings/ics/${b.cancelToken}`;

export function hostName(host: Host): string {
  return host.displayName || host.email;
}

function brandName(ctx: BookingCtx): string {
  return ctx.meetingType.brand?.name || hostName(ctx.host);
}

function accent(ctx: BookingCtx): string {
  return ctx.meetingType.brand?.accentColor || ctx.meetingType.color || "#18181b";
}

function replyTo(ctx: BookingCtx): string {
  return ctx.meetingType.brand?.replyTo || ctx.host.email;
}

/** Human description of where the meeting happens. */
export function whereText(b: Booking): string | null {
  const loc = b.location as LocationOption | null;
  if (!loc || loc.kind === "google_meet") return b.meetLink ? `Google Meet: ${b.meetLink}` : "Google Meet (link in the calendar invite)";
  if (loc.kind === "phone_invitee") return `Phone call. ${loc.value ? `We'll call you at ${loc.value}.` : ""}`.trim();
  if (loc.kind === "phone_host") return `Phone call: ${loc.value}`;
  return `${locationLabel(loc)}: ${loc.value}`;
}

/** Location string for calendar events (address / number / link). */
export function whereForCalendar(b: Booking): string | null {
  const loc = b.location as LocationOption | null;
  if (!loc || loc.kind === "google_meet") return b.meetLink;
  return loc.value ?? null;
}

export function calendarItem(ctx: BookingCtx, forHost = false): CalendarItem {
  const { booking, meetingType, host } = ctx;
  const other = forHost ? booking.name : hostName(host);
  return {
    uid: `${booking.id}@bookkit`,
    title: `${meetingType.name} with ${other}`,
    description: [whereText(booking), "", `Reschedule or cancel: ${manageUrl(booking)}`].filter((x) => x !== null).join("\n"),
    location: whereForCalendar(booking),
    start: booking.startTime,
    end: booking.endTime,
    organizerName: hostName(host),
    organizerEmail: host.email,
    url: manageUrl(booking),
    sequence: booking.rescheduleCount,
    cancelled: booking.status === "CANCELLED",
  };
}

function row(label: string, valueHtml: string): string {
  return `<tr><td style="padding:6px 16px 6px 0;color:#71717a;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;color:#18181b">${valueHtml}</td></tr>`;
}

function answersHtml(b: Booking): string {
  const list = Array.isArray(b.answers) ? (b.answers as { label: string; answer: string }[]) : [];
  if (!list.length) return "";
  return list
    .map(
      (a) =>
        `<p style="margin:0 0 2px;color:#71717a;font-size:13px">${escapeHtml(a.label)}</p><p style="margin:0 0 12px;white-space:pre-wrap">${escapeHtml(a.answer)}</p>`
    )
    .join("");
}

function answersText(b: Booking): string {
  const list = Array.isArray(b.answers) ? (b.answers as { label: string; answer: string }[]) : [];
  return list.map((a) => `${a.label}\n${a.answer}`).join("\n\n");
}

function footer(ctx: BookingCtx): string {
  const brand = ctx.meetingType.brand;
  return brand?.websiteUrl
    ? `Sent for <a href="${brand.websiteUrl}" style="color:#71717a">${escapeHtml(brand.name)}</a>`
    : `Sent for ${escapeHtml(brandName(ctx))}`;
}

function detailsTable(ctx: BookingCtx, tz: string, forHost: boolean): string {
  const { booking, meetingType, host } = ctx;
  const where = whereText(booking);
  const guests = booking.guests?.length ? booking.guests.map(escapeHtml).join(", ") : null;
  return `<table style="border-collapse:collapse;margin:0 0 18px;font-size:15px">
    ${row("What", `<strong>${escapeHtml(meetingType.name)}</strong>`)}
    ${row("When", escapeHtml(formatWhen(booking.startTime, tz)))}
    ${row("Who", escapeHtml(forHost ? `${booking.name} <${booking.email}>` : `${hostName(host)} and you`))}
    ${where ? row("Where", escapeHtml(where)) : ""}
    ${guests ? row("Guests", guests) : ""}
    ${booking.amountCents && booking.stripePaymentStatus ? row("Payment", escapeHtml(`${formatPrice(booking.amountCents, meetingType.currency)} (${booking.stripePaymentStatus})`)) : ""}
  </table>`;
}

function addToCalendarHtml(ctx: BookingCtx): string {
  const item = calendarItem(ctx);
  const link = (href: string, label: string) =>
    `<a href="${href}" style="color:#18181b;text-decoration:underline;margin-right:14px">${label}</a>`;
  return `<p style="margin:0 0 18px;font-size:14px">Add to calendar: ${link(googleCalendarLink(item), "Google")}${link(outlookCalendarLink(item), "Outlook")}${link(icsUrl(ctx.booking), "Apple / .ics")}</p>`;
}

// ---------------------------------------------------------------------------

export async function sendInviteeConfirmation(ctx: BookingCtx): Promise<boolean> {
  const { booking, meetingType } = ctx;
  const when = formatWhen(booking.startTime, booking.timezone);
  const pendingCalendar = !booking.googleEventId;
  const note = meetingType.confirmationNote?.trim();
  const html = emailShell(
    `
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${accent(ctx)};font-weight:700">Confirmed</p>
    <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3">You're booked with ${escapeHtml(hostName(ctx.host))}</h1>
    ${detailsTable(ctx, booking.timezone, false)}
    ${booking.meetLink ? `<p style="margin:0 0 18px">${button(booking.meetLink, "Join Google Meet", accent(ctx))}</p>` : ""}
    <p style="margin:0 0 18px;color:#3f3f46">${
      pendingCalendar
        ? "Your spot is held. The calendar invite will follow shortly."
        : "A calendar invite is on its way from Google as well."
    }</p>
    ${note ? `<p style="margin:0 0 18px;white-space:pre-wrap">${escapeHtml(note)}</p>` : ""}
    ${pendingCalendar ? addToCalendarHtml(ctx) : ""}
    <p style="margin:22px 0 0;font-size:14px;color:#52525b">Need a different time? <a href="${rescheduleUrl(booking)}" style="color:#18181b">Reschedule</a> or <a href="${cancelUrl(booking)}" style="color:#18181b">cancel</a>.</p>
  `,
    footer(ctx)
  );
  const text = [
    `You're booked: ${meetingType.name}`,
    "",
    `When: ${when}`,
    `Who: ${hostName(ctx.host)} and you`,
    whereText(booking) ?? "",
    note ?? "",
    "",
    `Reschedule: ${rescheduleUrl(booking)}`,
    `Cancel: ${cancelUrl(booking)}`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return sendMail({
    idempotencyKey: ctx.mailKey,
    to: booking.email,
    subject: `Confirmed: ${meetingType.name} on ${DateTime.fromJSDate(booking.startTime, { zone: booking.timezone }).toFormat("ccc LLL d 'at' h:mm a")}`,
    html,
    text,
    replyTo: replyTo(ctx),
    fromName: brandName(ctx),
    // Google already sends its own invite; attaching ours too would put the meeting on
    // their calendar twice. Only attach when the calendar write is still pending.
    ...(pendingCalendar ? { attachments: [icsAttachment(ctx)] } : {}),
  });
}

function icsAttachment(ctx: BookingCtx, filename = "invite.ics") {
  return { filename, content: buildIcs(calendarItem(ctx)), contentType: "text/calendar" };
}

export async function sendHostNotification(ctx: BookingCtx): Promise<boolean> {
  const { booking, meetingType, host } = ctx;
  const when = formatWhen(booking.startTime, host.timezone);
  const utm = booking.utm as Record<string, string> | null;
  const source = utm ? Object.entries(utm).map(([k, v]) => `${k}=${v}`).join(" · ") : null;
  return sendMail({
    idempotencyKey: ctx.mailKey,
    to: host.email,
    subject: `New booking: ${booking.name}, ${meetingType.name} (${DateTime.fromJSDate(booking.startTime, { zone: host.timezone }).toFormat("ccc LLL d, h:mm a")})`,
    html: emailShell(`
      <h1 style="margin:0 0 18px;font-size:20px">New booking${utm?.ref === "agent" ? " (booked by an AI agent)" : ""}</h1>
      ${detailsTable(ctx, host.timezone, true)}
      ${answersHtml(booking)}
      ${source ? `<p style="margin:0 0 12px;color:#71717a;font-size:13px">Source: ${escapeHtml(source)}</p>` : ""}
      <p style="margin:18px 0 0">${button(`${appUrl()}/admin/bookings/${booking.id}`, "Open booking")}</p>
    `),
    text: [`New booking: ${meetingType.name}`, `When: ${when}`, `Who: ${booking.name} <${booking.email}>`, whereText(booking) ?? "", "", answersText(booking), source ? `Source: ${source}` : ""].join("\n"),
    replyTo: booking.email,
    fromName: "OpenCalendar",
  });
}

export async function sendCancellation(ctx: BookingCtx, to: "invitee" | "host"): Promise<boolean> {
  const { booking, meetingType, host } = ctx;
  const tz = to === "host" ? host.timezone : booking.timezone;
  const when = formatWhen(booking.startTime, tz);
  const by = booking.cancelledBy === "host" ? hostName(host) : booking.cancelledBy === "invitee" ? booking.name : "OpenCalendar";
  const reason = booking.cancelReason?.trim();
  const refunded = booking.stripePaymentStatus === "refunded";
  const rebook = `${appUrl()}/${meetingType.slug}`;
  const title = to === "host" ? `Cancelled: ${booking.name}, ${meetingType.name}` : `Cancelled: ${meetingType.name}`;
  return sendMail({
    idempotencyKey: ctx.mailKey,
    to: to === "host" ? host.email : booking.email,
    subject: `${title} (${DateTime.fromJSDate(booking.startTime, { zone: tz }).toFormat("ccc LLL d, h:mm a")})`,
    html: emailShell(
      `
      <h1 style="margin:0 0 14px;font-size:20px">${to === "host" ? "A booking was cancelled" : "Your booking was cancelled"}</h1>
      <p style="margin:0 0 4px;color:#71717a">${escapeHtml(meetingType.name)}</p>
      <p style="margin:0 0 14px;font-size:16px"><s>${escapeHtml(when)}</s></p>
      <p style="margin:0 0 14px">Cancelled by ${escapeHtml(by)}.${reason ? ` Reason: “${escapeHtml(reason)}”` : ""}</p>
      ${refunded && to === "invitee" ? `<p style="margin:0 0 14px">Your payment has been refunded in full. It can take 5 to 10 days to show on your statement.</p>` : ""}
      ${to === "invitee" ? `<p style="margin:18px 0 0">${button(rebook, "Book a new time", accent(ctx))}</p>` : ""}
    `,
      to === "invitee" ? footer(ctx) : ""
    ),
    text: [title, when, `Cancelled by ${by}.`, reason ? `Reason: ${reason}` : "", to === "invitee" ? `Book a new time: ${rebook}` : ""].join("\n"),
    replyTo: to === "host" ? booking.email : replyTo(ctx),
    fromName: to === "host" ? "OpenCalendar" : brandName(ctx),
    ...(to === "invitee" && !booking.googleEventId ? { attachments: [icsAttachment(ctx, "cancel.ics")] } : {}),
  });
}

export async function sendRescheduled(ctx: BookingCtx, to: "invitee" | "host"): Promise<boolean> {
  const { booking, meetingType, host } = ctx;
  const tz = to === "host" ? host.timezone : booking.timezone;
  const when = formatWhen(booking.startTime, tz);
  const was = booking.previousStartTime ? formatWhen(booking.previousStartTime, tz) : null;
  return sendMail({
    idempotencyKey: ctx.mailKey,
    to: to === "host" ? host.email : booking.email,
    subject: `Rescheduled: ${meetingType.name}${to === "host" ? ` with ${booking.name}` : ""} → ${DateTime.fromJSDate(booking.startTime, { zone: tz }).toFormat("ccc LLL d, h:mm a")}`,
    html: emailShell(
      `
      <h1 style="margin:0 0 14px;font-size:20px">New time confirmed</h1>
      ${was ? `<p style="margin:0 0 6px;color:#71717a"><s>${escapeHtml(was)}</s></p>` : ""}
      ${detailsTable(ctx, tz, to === "host")}
      ${booking.cancelReason && to === "host" ? `<p style="margin:0 0 14px">Note: “${escapeHtml(booking.cancelReason)}”</p>` : ""}
      ${to === "invitee" && !booking.googleEventId ? addToCalendarHtml(ctx) : ""}
      ${to === "invitee" ? `<p style="margin:18px 0 0;font-size:14px;color:#52525b"><a href="${rescheduleUrl(booking)}" style="color:#18181b">Reschedule again</a> or <a href="${cancelUrl(booking)}" style="color:#18181b">cancel</a>.</p>` : ""}
    `,
      to === "invitee" ? footer(ctx) : ""
    ),
    text: [`Rescheduled: ${meetingType.name}`, was ? `Was: ${was}` : "", `Now: ${when}`, whereText(booking) ?? "", to === "invitee" ? `Manage: ${manageUrl(booking)}` : ""].join("\n"),
    replyTo: to === "host" ? booking.email : replyTo(ctx),
    fromName: to === "host" ? "OpenCalendar" : brandName(ctx),
    ...(to === "invitee" && !booking.googleEventId ? { attachments: [icsAttachment(ctx)] } : {}),
  });
}

export async function sendReminder(ctx: BookingCtx, minutesBefore: number): Promise<boolean> {
  const { booking, meetingType } = ctx;
  const when = formatWhen(booking.startTime, booking.timezone);
  const lead =
    minutesBefore >= 1440
      ? `in ${Math.round(minutesBefore / 1440)} day${minutesBefore >= 2880 ? "s" : ""}`
      : minutesBefore >= 60
        ? `in ${Math.round(minutesBefore / 60)} hour${minutesBefore >= 120 ? "s" : ""}`
        : `in ${minutesBefore} minutes`;
  return sendMail({
    idempotencyKey: ctx.mailKey,
    to: booking.email,
    subject: `Reminder: ${meetingType.name} ${lead}`,
    html: emailShell(
      `
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${accent(ctx)};font-weight:700">Reminder</p>
      <h1 style="margin:0 0 18px;font-size:21px">${escapeHtml(meetingType.name)} ${escapeHtml(lead)}</h1>
      ${detailsTable(ctx, booking.timezone, false)}
      ${booking.meetLink ? `<p style="margin:0 0 18px">${button(booking.meetLink, "Join Google Meet", accent(ctx))}</p>` : ""}
      <p style="margin:18px 0 0;font-size:14px;color:#52525b">Can't make it? <a href="${rescheduleUrl(booking)}" style="color:#18181b">Reschedule</a> or <a href="${cancelUrl(booking)}" style="color:#18181b">cancel</a>.</p>
    `,
      footer(ctx)
    ),
    text: [`Reminder: ${meetingType.name} ${lead}`, `When: ${when}`, whereText(booking) ?? "", `Reschedule: ${rescheduleUrl(booking)}`, `Cancel: ${cancelUrl(booking)}`].join("\n"),
    replyTo: replyTo(ctx),
    fromName: brandName(ctx),
  });
}

export async function sendFollowUp(ctx: BookingCtx): Promise<boolean> {
  const { booking, meetingType } = ctx;
  const rebook = `${appUrl()}/${meetingType.slug}`;
  return sendMail({
    idempotencyKey: ctx.mailKey,
    to: booking.email,
    subject: `Thanks for the call, ${booking.name.split(" ")[0]}`,
    html: emailShell(
      `
      <p style="margin:0 0 14px">Hi ${escapeHtml(booking.name.split(" ")[0])},</p>
      <p style="margin:0 0 14px">Thanks for making time for ${escapeHtml(meetingType.name)}. If you want to pick things up again, you can grab another slot any time.</p>
      <p style="margin:18px 0 0">${button(rebook, "Book another call", accent(ctx))}</p>
    `,
      footer(ctx)
    ),
    text: `Thanks for making time for ${meetingType.name}. Book another call: ${rebook}`,
    replyTo: replyTo(ctx),
    fromName: brandName(ctx),
  });
}

export async function sendConflictApology(ctx: BookingCtx, refunded: boolean): Promise<boolean> {
  const { booking, meetingType, host } = ctx;
  const when = formatWhen(booking.startTime, booking.timezone);
  const rebook = `${appUrl()}/${meetingType.slug}`;
  return sendMail({
    idempotencyKey: ctx.mailKey,
    to: booking.email,
    subject: `That time was taken: ${meetingType.name}`,
    html: emailShell(
      `
      <h1 style="margin:0 0 14px;font-size:20px">Sorry, that slot was just taken</h1>
      <p style="margin:0 0 14px">Someone else confirmed <strong>${escapeHtml(when)}</strong> a moment before your payment went through.</p>
      <p style="margin:0 0 14px">${
        refunded
          ? "Your payment has been refunded in full. It can take 5 to 10 days to appear."
          : `${escapeHtml(hostName(host))} has been told and will refund you personally.`
      }</p>
      <p style="margin:18px 0 0">${button(rebook, "Pick another time", accent(ctx))}</p>
    `,
      footer(ctx)
    ),
    text: `Sorry, ${when} was taken just before your payment went through. ${refunded ? "You've been refunded in full." : "You'll be refunded personally."} Pick another time: ${rebook}`,
    replyTo: replyTo(ctx),
    fromName: brandName(ctx),
  });
}
