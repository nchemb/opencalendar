/** Host-local wall-clock range, e.g. { start: "09:00", end: "17:00" }. */
export type HourRange = { start: string; end: string };

/** Keyed "0".."6" where 0 = Sunday. Missing key = unavailable that weekday. */
export type WeeklyHours = Record<string, HourRange[]>;

export const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  "1": [{ start: "09:00", end: "17:00" }],
  "2": [{ start: "09:00", end: "17:00" }],
  "3": [{ start: "09:00", end: "17:00" }],
  "4": [{ start: "09:00", end: "17:00" }],
  "5": [{ start: "09:00", end: "17:00" }],
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseWeeklyHours(value: unknown): WeeklyHours {
  const out: WeeklyHours = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;

  for (const [day, ranges] of Object.entries(value as Record<string, unknown>)) {
    const dayNum = Number(day);
    if (!Number.isInteger(dayNum) || dayNum < 0 || dayNum > 6) continue;
    if (!Array.isArray(ranges)) continue;

    const clean: HourRange[] = [];
    for (const r of ranges) {
      if (!r || typeof r !== "object") continue;
      const start = (r as HourRange).start;
      const end = (r as HourRange).end;
      if (typeof start !== "string" || typeof end !== "string") continue;
      if (!TIME_RE.test(start) || !TIME_RE.test(end)) continue;
      if (toMinutes(end) <= toMinutes(start)) continue;
      clean.push({ start, end });
    }
    if (clean.length) {
      clean.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
      out[String(dayNum)] = clean;
    }
  }
  return out;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** A custom form field the host asks bookers to fill in. */
export type BookingQuestion = { label: string; required: boolean };

export const MAX_QUESTIONS = 5;

export function parseQuestions(value: unknown): BookingQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: BookingQuestion[] = [];
  for (const q of value) {
    if (!q || typeof q !== "object") continue;
    const label = typeof (q as BookingQuestion).label === "string" ? (q as BookingQuestion).label.trim() : "";
    if (!label) continue;
    out.push({ label: label.slice(0, 200), required: (q as BookingQuestion).required === true });
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}

export type PublicMeetingType = {
  slug: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number | null;
  currency: string;
  color: string;
  questions: BookingQuestion[];
  displayMode: "popup" | "inline";
  hostName: string;
  hostTimezone: string;
};

export type SlotsResponse = {
  ok: true;
  slots: string[]; // UTC ISO instants
  timezone: string; // echo of the booker timezone used for display
  durationMinutes: number;
};
