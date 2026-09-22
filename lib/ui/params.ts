/**
 * URL params shared by /[slug] and /embed/[slug] — see docs/EMBED-PROTOCOL.md.
 * One parser so both routes stay in lockstep with the contract.
 */
export type BookingParams = {
  name: string;
  email: string;
  /** By question id (q_<id>=...) merged with by-position (a1..a10, applied first so id wins). */
  answers: Record<string, string>;
  guests: string;
  duration: number | null;
  date: string | null;
  month: string | null;
  link: string | null;
  tz: string | null;
  hideDetails: boolean;
  theme: "light" | "dark" | "auto" | null;
  accent: string | null;
  embedId: string | null;
  utm: Record<string, string>;
};

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "src"];

export function parseBookingParams(
  sp: Record<string, string | string[] | undefined>,
  questionIds: string[]
): BookingParams {
  const get = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
  };

  const first = get("first_name");
  const last = get("last_name");
  const name = get("name") ?? [first, last].filter(Boolean).join(" ");

  const answers: Record<string, string> = {};
  questionIds.forEach((id, i) => {
    const positional = get(`a${i + 1}`);
    if (positional) answers[id] = positional;
    const byId = get(`q_${id}`);
    if (byId) answers[id] = byId;
  });

  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = get(k);
    if (v) utm[k] = v;
  }

  const duration = get("duration");
  const theme = get("theme");
  const accent = get("accent");

  return {
    name,
    email: get("email") ?? "",
    answers,
    guests: get("guests") ?? "",
    duration: duration && /^\d+$/.test(duration) ? Number(duration) : null,
    date: get("date") ?? null,
    month: get("month") ?? null,
    link: get("link") ?? null,
    tz: get("tz") ?? null,
    hideDetails: get("hide_details") === "1" || get("hide_details") === "true",
    theme: theme === "light" || theme === "dark" || theme === "auto" ? theme : null,
    accent: accent && /^[0-9a-fA-F]{6}$/.test(accent) ? `#${accent}` : null,
    embedId: get("embed_id") ?? null,
    utm,
  };
}
