/** Minimal RFC 5545 builder + "add to calendar" deep links. No dependencies. */

export type CalendarItem = {
  uid: string;
  title: string;
  description: string;
  location?: string | null;
  start: Date;
  end: Date;
  organizerName?: string;
  organizerEmail?: string;
  url?: string;
  cancelled?: boolean;
  sequence?: number;
};

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** Fold lines at 75 octets as the spec requires. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = ch;
    } else cur += ch;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export function buildIcs(item: CalendarItem): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OpenCalendar//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${item.cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${item.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(item.start)}`,
    `DTEND:${stamp(item.end)}`,
    `SEQUENCE:${item.sequence ?? 0}`,
    `SUMMARY:${esc(item.title)}`,
    `DESCRIPTION:${esc(item.description)}`,
    ...(item.location ? [`LOCATION:${esc(item.location)}`] : []),
    ...(item.url ? [`URL:${item.url}`] : []),
    ...(item.organizerEmail
      ? [`ORGANIZER;CN=${esc(item.organizerName ?? item.organizerEmail)}:mailto:${item.organizerEmail}`]
      : []),
    `STATUS:${item.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function googleCalendarLink(item: CalendarItem): string {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: item.title,
    dates: `${stamp(item.start)}/${stamp(item.end)}`,
    details: item.description,
    ...(item.location ? { location: item.location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export function outlookCalendarLink(item: CalendarItem): string {
  const p = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: item.title,
    startdt: item.start.toISOString(),
    enddt: item.end.toISOString(),
    body: item.description,
    ...(item.location ? { location: item.location } : {}),
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p.toString()}`;
}
