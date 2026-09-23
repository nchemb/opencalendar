import {
  LOCATION_KINDS,
  MAX_QUESTIONS,
  parseLocations,
  parseOverrides,
  parseQuestions,
  parseWeeklyHours,
  type BookingQuestion,
  type DateOverride,
  type LocationOption,
  type WeeklyHours,
} from "./types";
import { cleanString, isSlug, isValidTimezone } from "./validate";

export class ValidationError extends Error {}

function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function optionalInt(value: unknown, min: number, max: number): number | null {
  if (value === null || value === "" || value === undefined) return null;
  return int(value, min, min, max);
}

function optionalUrl(value: unknown, label = "URL"): string | null {
  const v = cleanString(value, 500);
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
    return u.toString();
  } catch {
    throw new ValidationError(`${label} must be a valid http(s) URL.`);
  }
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

// ---------------------------------------------------------------------------
// Meeting type (event type)
// ---------------------------------------------------------------------------

export type MeetingTypeFields = {
  slug: string;
  name: string;
  description: string | null;
  brandId: string | null;
  scheduleId: string | null;
  durationMinutes: number;
  durationOptions: { minutes: number; priceCents: number | null }[] | null;
  priceCents: number | null;
  currency: string;
  color: string;
  windowType: "CALENDAR_DAYS" | "BUSINESS_DAYS" | "DATE_RANGE" | "INDEFINITE";
  daysInAdvance: number;
  windowStart: string | null;
  windowEnd: string | null;
  minNoticeMinutes: number;
  startIncrementMinutes: number | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  dailyLimit: number | null;
  weeklyLimit: number | null;
  locations: LocationOption[];
  questions: BookingQuestion[];
  allowGuests: boolean;
  maxGuests: number;
  redirectUrl: string | null;
  redirectPassParams: boolean;
  confirmationNote: string | null;
  cancelCutoffHours: number | null;
  refundPolicy: "before_cutoff" | "always" | "never";
  policyText: string | null;
  reminderMinutes: number[];
  followUpMinutes: number | null;
  secret: boolean;
  agentBookable: boolean;
  displayMode: "popup" | "inline";
  active: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[a-z]{3}$/;

function parseDurationOptions(value: unknown, basePrice: number | null): MeetingTypeFields["durationOptions"] {
  if (!Array.isArray(value) || !value.length) return null;
  const out: { minutes: number; priceCents: number | null }[] = [];
  for (const d of value) {
    if (!d || typeof d !== "object") continue;
    const minutes = int((d as { minutes?: unknown }).minutes, 0, 5, 720);
    if (!minutes || out.some((o) => o.minutes === minutes)) continue;
    const p = (d as { priceCents?: unknown }).priceCents;
    const priceCents = p === null || p === undefined || p === "" ? basePrice : Math.max(0, int(p, 0, 0, 100_000_00)) || null;
    out.push({ minutes, priceCents });
    if (out.length >= 8) break;
  }
  return out.length ? out.sort((a, b) => a.minutes - b.minutes) : null;
}

function parseLocationsInput(value: unknown): LocationOption[] {
  if (!Array.isArray(value)) return [{ kind: "google_meet" }];
  return parseLocations(
    value.filter((l) => l && typeof l === "object" && LOCATION_KINDS.includes((l as LocationOption).kind))
  );
}

function parseQuestionsInput(value: unknown): BookingQuestion[] {
  return parseQuestions(value).slice(0, MAX_QUESTIONS);
}

function parseReminderMinutes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const v of value) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0 && n <= 30 * 24 * 60 && !out.includes(n)) out.push(n);
    if (out.length >= 10) break;
  }
  return out.sort((a, b) => b - a);
}

export function parseMeetingTypeInput(body: Record<string, unknown>): MeetingTypeFields {
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!isSlug(slug)) throw new ValidationError("Slug must be lowercase letters, numbers and dashes.");

  const name = cleanString(body.name, 120);
  if (!name) throw new ValidationError("Name is required.");

  const rawPrice = body.priceCents;
  const priceCents =
    rawPrice === null || rawPrice === "" || rawPrice === undefined
      ? null
      : Math.max(0, int(rawPrice, 0, 0, 100_000_00)) || null;

  const color = cleanString(body.color, 9) ?? "#FF6A00";
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new ValidationError("Color must be a hex value like #FF6A00.");

  const currency = (cleanString(body.currency, 3) ?? "usd").toLowerCase();
  if (!CURRENCY_RE.test(currency)) throw new ValidationError("Currency must be a 3-letter code like usd.");

  const windowType = ["CALENDAR_DAYS", "BUSINESS_DAYS", "DATE_RANGE", "INDEFINITE"].includes(body.windowType as string)
    ? (body.windowType as MeetingTypeFields["windowType"])
    : "CALENDAR_DAYS";

  let windowStart: string | null = null;
  let windowEnd: string | null = null;
  if (windowType === "DATE_RANGE") {
    windowStart = typeof body.windowStart === "string" && DATE_RE.test(body.windowStart) ? body.windowStart : null;
    windowEnd = typeof body.windowEnd === "string" && DATE_RE.test(body.windowEnd) ? body.windowEnd : null;
    if (!windowStart || !windowEnd) throw new ValidationError("Set both a start and end date for a fixed date range.");
    if (windowEnd < windowStart) throw new ValidationError("The window end date must be after the start date.");
  }

  const refundPolicy = ["before_cutoff", "always", "never"].includes(body.refundPolicy as string)
    ? (body.refundPolicy as MeetingTypeFields["refundPolicy"])
    : "before_cutoff";

  return {
    slug,
    name,
    description: cleanString(body.description, 4000),
    brandId: typeof body.brandId === "string" && body.brandId ? body.brandId : null,
    scheduleId: typeof body.scheduleId === "string" && body.scheduleId ? body.scheduleId : null,
    durationMinutes: int(body.durationMinutes, 30, 5, 720),
    durationOptions: parseDurationOptions(body.durationOptions, priceCents),
    priceCents,
    currency,
    color,
    windowType,
    daysInAdvance: int(body.daysInAdvance, 30, 0, 365),
    windowStart,
    windowEnd,
    minNoticeMinutes: int(body.minNoticeMinutes, 720, 0, 90 * 24 * 60),
    startIncrementMinutes: optionalInt(body.startIncrementMinutes, 5, 480),
    bufferBeforeMinutes: int(body.bufferBeforeMinutes, 0, 0, 480),
    bufferAfterMinutes: int(body.bufferAfterMinutes, 0, 0, 480),
    dailyLimit: optionalInt(body.dailyLimit, 1, 200),
    weeklyLimit: optionalInt(body.weeklyLimit, 1, 500),
    locations: parseLocationsInput(body.locations),
    questions: parseQuestionsInput(body.questions),
    allowGuests: bool(body.allowGuests, true),
    maxGuests: int(body.maxGuests, 10, 0, 25),
    redirectUrl: optionalUrl(body.redirectUrl, "Redirect URL"),
    redirectPassParams: bool(body.redirectPassParams, false),
    confirmationNote: cleanString(body.confirmationNote, 2000),
    cancelCutoffHours: optionalInt(body.cancelCutoffHours, 0, 24 * 30),
    refundPolicy,
    policyText: cleanString(body.policyText, 2000),
    reminderMinutes: parseReminderMinutes(body.reminderMinutes ?? [1440, 60]),
    followUpMinutes: optionalInt(body.followUpMinutes, 5, 30 * 24 * 60),
    secret: bool(body.secret, false),
    agentBookable: bool(body.agentBookable, false),
    displayMode: body.displayMode === "inline" ? "inline" : "popup",
    active: body.active !== false,
  };
}

// ---------------------------------------------------------------------------
// Host settings (profile + Google calendar selection + pause switch)
// ---------------------------------------------------------------------------

export function parseHostInput(body: Record<string, unknown>) {
  const timezone = body.timezone;
  if (!isValidTimezone(timezone)) throw new ValidationError("Invalid timezone.");
  const conflictCalendarIds = Array.isArray(body.conflictCalendarIds)
    ? body.conflictCalendarIds.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, 20)
    : undefined;
  return {
    timezone: timezone as string,
    displayName: cleanString(body.displayName, 120),
    avatarUrl: optionalUrl(body.avatarUrl, "Avatar URL"),
    ...(typeof body.googleCalendarId === "string" && body.googleCalendarId ? { googleCalendarId: body.googleCalendarId } : {}),
    ...(conflictCalendarIds ? { conflictCalendarIds } : {}),
  };
}

export function parsePauseInput(body: Record<string, unknown>) {
  const pausedUntil =
    typeof body.pausedUntil === "string" && body.pausedUntil
      ? (() => {
          const d = new Date(body.pausedUntil as string);
          if (Number.isNaN(d.getTime())) throw new ValidationError("Invalid pause-until date.");
          return d;
        })()
      : null;
  return {
    paused: bool(body.paused, false),
    pausedUntil,
    pausedMessage: cleanString(body.pausedMessage, 500),
  };
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export type ScheduleFields = { name: string; timezone: string; weeklyHours: WeeklyHours; overrides: DateOverride[]; isDefault: boolean };

export function parseScheduleInput(body: Record<string, unknown>): ScheduleFields {
  const name = cleanString(body.name, 120);
  if (!name) throw new ValidationError("Schedule name is required.");
  if (!isValidTimezone(body.timezone)) throw new ValidationError("Invalid timezone.");
  return {
    name,
    timezone: body.timezone as string,
    weeklyHours: parseWeeklyHours(body.weeklyHours),
    overrides: parseOverrides(body.overrides),
    isDefault: bool(body.isDefault, false),
  };
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

export type BrandFields = {
  slug: string;
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  accentColor: string;
  theme: "auto" | "light" | "dark";
  websiteUrl: string | null;
  replyTo: string | null;
  showPoweredBy: boolean;
};

export function parseBrandInput(body: Record<string, unknown>): BrandFields {
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!isSlug(slug)) throw new ValidationError("Slug must be lowercase letters, numbers and dashes.");
  const name = cleanString(body.name, 120);
  if (!name) throw new ValidationError("Name is required.");
  const accentColor = cleanString(body.accentColor, 9) ?? "#FF6A00";
  if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) throw new ValidationError("Accent color must be a hex value.");
  const replyTo = cleanString(body.replyTo, 254);
  if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(replyTo)) throw new ValidationError("Reply-to must be a valid email.");
  return {
    slug,
    name,
    tagline: cleanString(body.tagline, 200),
    logoUrl: optionalUrl(body.logoUrl, "Logo URL"),
    accentColor,
    theme: body.theme === "light" || body.theme === "dark" ? body.theme : "auto",
    websiteUrl: optionalUrl(body.websiteUrl, "Website URL"),
    replyTo,
    showPoweredBy: bool(body.showPoweredBy, true),
  };
}

// ---------------------------------------------------------------------------
// Webhook endpoint
// ---------------------------------------------------------------------------

export function parseWebhookEndpointInput(body: Record<string, unknown>, events: readonly string[]) {
  const url = cleanString(body.url, 500);
  if (!url) throw new ValidationError("URL is required.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError("Not a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new ValidationError("Webhook URL must use https (localhost excepted).");
  }
  const chosen = Array.isArray(body.events) ? body.events.filter((e): e is string => events.includes(e as string)) : [];
  return { url: parsed.toString(), events: chosen };
}

// ---------------------------------------------------------------------------
// Single-use link
// ---------------------------------------------------------------------------

export function parseSingleUseLinkInput(body: Record<string, unknown>) {
  const expiresAt =
    typeof body.expiresAt === "string" && body.expiresAt
      ? (() => {
          const d = new Date(body.expiresAt as string);
          if (Number.isNaN(d.getTime())) throw new ValidationError("Invalid expiry date.");
          return d;
        })()
      : null;
  return {
    label: cleanString(body.label, 120),
    durationMinutes: optionalInt(body.durationMinutes, 5, 720),
    priceCents:
      body.priceCents === null || body.priceCents === "" || body.priceCents === undefined
        ? null
        : Math.max(0, int(body.priceCents, 0, 0, 100_000_00)),
    expiresAt,
  };
}
