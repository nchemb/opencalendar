import type { Booking, MeetingType } from "@prisma/client";
import { DateTime } from "luxon";

function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formulas: an invitee named "=HYPERLINK(...)" must stay text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADERS = [
  "id",
  "meeting_type",
  "name",
  "email",
  "status",
  "start_time",
  "end_time",
  "timezone",
  "amount_cents",
  "payment_status",
  "utm_source",
  "no_show",
  "created_at",
];

export function bookingsToCsv(rows: (Booking & { meetingType: Pick<MeetingType, "name"> })[], tz: string): string {
  const lines = [HEADERS.join(",")];
  for (const b of rows) {
    const utm = b.utm as Record<string, string> | null;
    lines.push(
      [
        b.id,
        b.meetingType.name,
        b.name,
        b.email,
        b.status,
        DateTime.fromJSDate(b.startTime, { zone: tz }).toISO(),
        DateTime.fromJSDate(b.endTime, { zone: tz }).toISO(),
        b.timezone,
        b.amountCents ?? "",
        b.stripePaymentStatus ?? "",
        utm?.utm_source ?? "",
        b.noShow ? "yes" : "no",
        b.createdAt.toISOString(),
      ]
        .map(cell)
        .join(",")
    );
  }
  return lines.join("\n");
}
