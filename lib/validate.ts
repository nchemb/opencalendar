import { DateTime } from "luxon";

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

export type AnsweredQuestion = { label: string; answer: string };

/**
 * Zips submitted answers with the meeting type's questions, enforcing required
 * fields server-side. Returns the structured pairs plus a display string.
 */
export function parseAnswers(
  raw: unknown,
  questions: { label: string; required: boolean }[]
):
  | { ok: true; answers: AnsweredQuestion[]; display: string | null }
  | { ok: false; error: string } {
  const list = Array.isArray(raw) ? raw : [];

  const answers: AnsweredQuestion[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const value = typeof list[i] === "string" ? (list[i] as string).trim().slice(0, 2000) : "";
    if (q.required && !value) {
      return { ok: false, error: `Please answer: ${q.label}` };
    }
    if (value) answers.push({ label: q.label, answer: value });
  }

  const display = answers.length
    ? answers.map((a) => `${a.label}\n${a.answer}`).join("\n\n")
    : null;
  return { ok: true, answers, display };
}

/** Honeypot + minimum fill time — cheap bot filter on public forms. */
export function looksLikeBot(body: Record<string, unknown>): boolean {
  if (cleanString(body.company, 100)) return true; // honeypot field
  const elapsed = Number(body.elapsedMs);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 1500) return true;
  return false;
}
