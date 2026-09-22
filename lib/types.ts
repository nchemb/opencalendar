/** Wall-clock range in the schedule timezone, e.g. { start: "09:00", end: "17:00" }. End may be "24:00". */
export type HourRange = { start: string; end: string };

/** Keyed "0".."6" where 0 = Sunday. Missing key = unavailable that weekday. */
export type WeeklyHours = Record<string, HourRange[]>;

/** A date whose hours replace the weekly pattern. Empty ranges = unavailable all day. */
export type DateOverride = { date: string; ranges: HourRange[] };

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

const START_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const END_RE = /^(([01]\d|2[0-3]):([0-5]\d)|24:00)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function parseRanges(value: unknown): HourRange[] {
  if (!Array.isArray(value)) return [];
  const clean: HourRange[] = [];
  for (const r of value) {
    if (!r || typeof r !== "object") continue;
    const { start, end } = r as HourRange;
    if (typeof start !== "string" || typeof end !== "string") continue;
    if (!START_RE.test(start) || !END_RE.test(end)) continue;
    if (toMinutes(end) <= toMinutes(start)) continue;
    clean.push({ start, end });
  }
  clean.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  // Merge overlapping ranges — overlaps would otherwise double-offer slots.
  const out: HourRange[] = [];
  for (const r of clean) {
    const prev = out[out.length - 1];
    if (prev && toMinutes(r.start) < toMinutes(prev.end)) {
      if (toMinutes(r.end) > toMinutes(prev.end)) prev.end = r.end;
      continue;
    }
    out.push({ ...r });
  }
  return out;
}

export function parseWeeklyHours(value: unknown): WeeklyHours {
  const out: WeeklyHours = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [day, ranges] of Object.entries(value as Record<string, unknown>)) {
    const dayNum = Number(day);
    if (!Number.isInteger(dayNum) || dayNum < 0 || dayNum > 6) continue;
    const clean = parseRanges(ranges);
    if (clean.length) out[String(dayNum)] = clean;
  }
  return out;
}

export function parseOverrides(value: unknown): DateOverride[] {
  if (!Array.isArray(value)) return [];
  const byDate = new Map<string, DateOverride>();
  for (const o of value) {
    if (!o || typeof o !== "object") continue;
    const date = (o as DateOverride).date;
    if (typeof date !== "string" || !DATE_RE.test(date)) continue;
    byDate.set(date, { date, ranges: parseRanges((o as DateOverride).ranges) });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Invitee questions
// ---------------------------------------------------------------------------

export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "single_choice",
  "multi_choice",
  "dropdown",
  "phone",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export type BookingQuestion = {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
};

export const MAX_QUESTIONS = 10;

export function parseQuestions(value: unknown): BookingQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: BookingQuestion[] = [];
  const ids = new Set<string>();
  for (const q of value) {
    if (!q || typeof q !== "object") continue;
    const raw = q as Partial<BookingQuestion>;
    const label = typeof raw.label === "string" ? raw.label.trim().slice(0, 200) : "";
    if (!label) continue;
    // v1 questions had no type: they were free text.
    const type: QuestionType = QUESTION_TYPES.includes(raw.type as QuestionType)
      ? (raw.type as QuestionType)
      : "long_text";
    const options =
      type === "single_choice" || type === "multi_choice" || type === "dropdown"
        ? (Array.isArray(raw.options) ? raw.options : [])
            .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
            .map((o) => o.trim().slice(0, 120))
            .slice(0, 20)
        : undefined;
    if (options && options.length === 0) continue; // a choice question with no choices is unusable
    let id =
      typeof raw.id === "string" && /^[a-z0-9_-]{1,32}$/i.test(raw.id) ? raw.id : `q${out.length + 1}`;
    while (ids.has(id)) id = `${id}_`;
    ids.add(id);
    out.push({ id, label, type, required: raw.required === true, ...(options ? { options } : {}) });
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export const LOCATION_KINDS = [
  "google_meet",
  "link",
  "phone_invitee",
  "phone_host",
  "in_person",
  "custom",
] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];
export type LocationOption = { kind: LocationKind; value?: string | null; label?: string | null };

export const LOCATION_LABELS: Record<LocationKind, string> = {
  google_meet: "Google Meet",
  link: "Video call",
  phone_invitee: "Phone call (host calls you)",
  phone_host: "Phone call",
  in_person: "In person",
  custom: "Other",
};

export function parseLocations(value: unknown): LocationOption[] {
  if (!Array.isArray(value)) return [{ kind: "google_meet" }];
  const out: LocationOption[] = [];
  for (const l of value) {
    if (!l || typeof l !== "object") continue;
    const kind = (l as LocationOption).kind;
    if (!LOCATION_KINDS.includes(kind)) continue;
    const v = (l as LocationOption).value;
    const label = (l as LocationOption).label;
    const value = typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null;
    // These kinds are meaningless without the host-supplied detail.
    if ((kind === "link" || kind === "phone_host" || kind === "in_person" || kind === "custom") && !value)
      continue;
    if (out.some((o) => o.kind === kind && o.value === value)) continue;
    out.push({
      kind,
      value,
      label: typeof label === "string" && label.trim() ? label.trim().slice(0, 80) : null,
    });
    if (out.length >= 6) break;
  }
  return out.length ? out : [{ kind: "google_meet" }];
}

export function locationLabel(l: LocationOption): string {
  return l.label || LOCATION_LABELS[l.kind];
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

export type DurationOption = { minutes: number; priceCents: number | null };

/** All selectable durations, ascending. The type's default duration is always included. */
export function durationChoices(mt: {
  durationMinutes: number;
  priceCents: number | null;
  durationOptions: unknown;
}): DurationOption[] {
  const out: DurationOption[] = [{ minutes: mt.durationMinutes, priceCents: mt.priceCents }];
  if (Array.isArray(mt.durationOptions)) {
    for (const d of mt.durationOptions) {
      const minutes = Number((d as DurationOption)?.minutes);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 720) continue;
      if (out.some((o) => o.minutes === minutes)) continue;
      const p = (d as DurationOption).priceCents;
      const priceCents =
        p === null || p === undefined
          ? mt.priceCents
          : Number.isInteger(p) && (p as number) > 0
            ? (p as number)
            : null;
      out.push({ minutes, priceCents });
    }
  }
  return out.sort((a, b) => a.minutes - b.minutes);
}

// ---------------------------------------------------------------------------
// Public API shapes
// ---------------------------------------------------------------------------

export type PublicBrand = {
  slug: string;
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  accentColor: string;
  theme: "auto" | "light" | "dark";
  websiteUrl: string | null;
  showPoweredBy: boolean;
};

export type PublicMeetingType = {
  slug: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  durations: DurationOption[];
  priceCents: number | null;
  currency: string;
  color: string;
  questions: BookingQuestion[];
  locations: LocationOption[];
  allowGuests: boolean;
  maxGuests: number;
  policyText: string | null;
  cancelCutoffHours: number | null;
  displayMode: "popup" | "inline";
  hostName: string;
  hostAvatarUrl: string | null;
  hostTimezone: string;
  brand: PublicBrand | null;
};

export type SlotsResponse = {
  ok: true;
  slots: string[]; // UTC ISO instants
  timezone: string;
  durationMinutes: number;
  paused?: string | null;
};
