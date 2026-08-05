import { MAX_QUESTIONS, parseQuestions, parseWeeklyHours, type BookingQuestion, type WeeklyHours } from "./types";
import { cleanString, isSlug, isValidTimezone } from "./validate";

export type MeetingTypeFields = {
  slug: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number | null;
  currency: string;
  color: string;
  weeklyHours: WeeklyHours;
  daysInAdvance: number;
  minNoticeHours: number;
  bufferMinutes: number;
  dailyLimit: number | null;
  questions: BookingQuestion[];
  /** Always cleared on save — superseded by questions; prevents the legacy fallback resurrecting. */
  customQuestion: null;
  redirectUrl: string | null;
  displayMode: "popup" | "inline";
  active: boolean;
};

export class ValidationError extends Error {}

function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function optionalUrl(value: unknown): string | null {
  const v = cleanString(value, 500);
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
    return u.toString();
  } catch {
    throw new ValidationError("Redirect URL must be a valid http(s) URL.");
  }
}

export function parseMeetingTypeInput(body: Record<string, unknown>): MeetingTypeFields {
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!isSlug(slug)) {
    throw new ValidationError("Slug must be lowercase letters, numbers and dashes.");
  }

  const name = cleanString(body.name, 120);
  if (!name) throw new ValidationError("Name is required.");

  const weeklyHours = parseWeeklyHours(body.weeklyHours);
  if (!Object.keys(weeklyHours).length) {
    throw new ValidationError("Set at least one weekly availability window.");
  }

  const rawPrice = body.priceCents;
  const priceCents =
    rawPrice === null || rawPrice === "" || rawPrice === undefined
      ? null
      : int(rawPrice, 0, 0, 10_000_00) || null;

  const color = cleanString(body.color, 9) ?? "#FF6A00";
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new ValidationError("Color must be a hex value like #FF6A00.");
  }

  const rawLimit = body.dailyLimit;
  const dailyLimit =
    rawLimit === null || rawLimit === "" || rawLimit === undefined
      ? null
      : int(rawLimit, 0, 0, 50) || null;

  const displayMode = body.displayMode === "inline" ? "inline" : "popup";

  return {
    slug,
    name,
    description: cleanString(body.description, 2000),
    durationMinutes: int(body.durationMinutes, 30, 5, 480),
    priceCents,
    currency: (cleanString(body.currency, 3) ?? "usd").toLowerCase(),
    color,
    weeklyHours,
    daysInAdvance: int(body.daysInAdvance, 30, 1, 365),
    minNoticeHours: int(body.minNoticeHours, 12, 0, 720),
    bufferMinutes: int(body.bufferMinutes, 0, 0, 240),
    dailyLimit,
    questions: parseQuestions(body.questions).slice(0, MAX_QUESTIONS),
    customQuestion: null,
    redirectUrl: optionalUrl(body.redirectUrl),
    displayMode,
    active: body.active !== false,
  };
}

export function parseHostInput(body: Record<string, unknown>) {
  const timezone = body.timezone;
  if (!isValidTimezone(timezone)) throw new ValidationError("Invalid timezone.");
  return {
    timezone: timezone as string,
    displayName: cleanString(body.displayName, 120),
  };
}
