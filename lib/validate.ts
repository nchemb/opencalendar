import { DateTime } from "luxon";
import type { BookingQuestion } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL_RE.test(value.trim());
}

export function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  return v.slice(0, max);
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  return DateTime.local().setZone(tz).isValid;
}

export function isSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

/** Parses an ISO instant. Returns null unless it is a real, whole-minute time. */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const dt = DateTime.fromISO(value, { setZone: true });
  if (!dt.isValid) return null;
  const js = dt.toUTC().toJSDate();
  if (js.getUTCSeconds() !== 0 || js.getUTCMilliseconds() !== 0) return null;
  return js;
}

export type AnsweredQuestion = { id: string; label: string; answer: string };

const PHONE_RE = /^[+()\d][\d\s().-]{5,24}$/;

/**
 * Validate submitted answers against the meeting type's questions, server-side.
 * Accepts either an array aligned with the questions or an object keyed by id.
 * Choice answers must be one of the offered options; multi-choice joins with ", ".
 */
export function parseAnswers(
  raw: unknown,
  questions: BookingQuestion[]
):
  | { ok: true; answers: AnsweredQuestion[]; display: string | null }
  | { ok: false; error: string } {
  const byId: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(raw) ? raw : [];

  const answers: AnsweredQuestion[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const rawValue = q.id in byId ? byId[q.id] : list[i];
    let value = "";

    if (q.type === "multi_choice") {
      const picked = (Array.isArray(rawValue) ? rawValue : typeof rawValue === "string" && rawValue ? [rawValue] : [])
        .filter((v): v is string => typeof v === "string");
      const valid = picked.filter((v) => q.options?.includes(v));
      if (valid.length !== picked.length) return { ok: false, error: `Pick from the options for: ${q.label}` };
      value = valid.join(", ");
    } else {
      value = typeof rawValue === "string" ? rawValue.trim().slice(0, q.type === "long_text" ? 4000 : 500) : "";
      if (value && (q.type === "single_choice" || q.type === "dropdown") && !q.options?.includes(value)) {
        return { ok: false, error: `Pick from the options for: ${q.label}` };
      }
      if (value && q.type === "phone" && !PHONE_RE.test(value)) {
        return { ok: false, error: `Enter a valid phone number for: ${q.label}` };
      }
    }

    if (q.required && !value) return { ok: false, error: `Please answer: ${q.label}` };
    if (value) answers.push({ id: q.id, label: q.label, answer: value });
  }

  const display = answers.length ? answers.map((a) => `${a.label}\n${a.answer}`).join("\n\n") : null;
  return { ok: true, answers, display };
}

/** Up to `max` distinct, valid guest emails (excluding the booker). */
export function parseGuests(raw: unknown, max: number, bookerEmail: string): string[] | { error: string } {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[\s,;]+/)
      : [];
  const out: string[] = [];
  for (const g of items) {
    if (typeof g !== "string" || !g.trim()) continue;
    const email = g.trim().toLowerCase();
    if (!isEmail(email)) return { error: `"${g.trim().slice(0, 60)}" is not a valid guest email.` };
    if (email === bookerEmail.toLowerCase() || out.includes(email)) continue;
    out.push(email);
  }
  if (out.length > max) return { error: `You can add up to ${max} guests.` };
  return out;
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "src"];

/** Keep only known tracking keys, trimmed. */
export function parseUtm(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 120);
  }
  return Object.keys(out).length ? out : null;
}

/** Honeypot + minimum fill time — cheap bot filter on public forms. */
export function looksLikeBot(body: Record<string, unknown>): boolean {
  if (cleanString(body.company, 100)) return true; // honeypot field
  const elapsed = Number(body.elapsedMs);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 1500) return true;
  return false;
}
