/**
 * Import event types from a public Calendly profile into BookKit.
 *
 *   npm run import:calendly -- <https://calendly.com/profile-slug> [--brand <slug>] [--dry-run]
 *
 * Reads Calendly's public (undocumented, unauthenticated) booking API — the same
 * one a visitor's browser calls when it renders a Calendly page — so no Calendly
 * API key is needed. Idempotent: re-running upserts by meeting type slug.
 *
 * What it can and can't see from that API, honestly:
 *  - Name, slug, description, duration, price/currency, locations, invitee
 *    questions, and the scheduling window (calendar vs. business days) are all
 *    read directly.
 *  - Weekly hours and the start-time increment are INFERRED from ~30 days of
 *    observed open slots (calendar/range), per weekday: earliest start -> latest
 *    end. A single Schedule is created per profile from the union of every
 *    imported event type's observed hours.
 *  - Minimum notice, buffers, daily/weekly limits and max guests are not exposed
 *    by this API at all — they're left at BookKit's defaults. Review them after
 *    import.
 *  - Whether an event type is "secret" is unknowable from here: a secret link
 *    never appears in the public profile's event-type list, so anything this
 *    script finds is, by construction, public. Secret links must be recreated
 *    by hand.
 */
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import { parseLocations, parseQuestions, type BookingQuestion, type HourRange, type LocationOption, type WeeklyHours } from "../lib/types";

const prisma = new PrismaClient();

const API_BASE = "https://calendly.com/api/booking";
const RANGE_DAYS = 30;
const SCHEDULE_NAME = "Imported from Calendly";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  let profileUrl: string | undefined;
  let brandSlug: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--brand") brandSlug = argv[++i];
    else if (!a.startsWith("--") && !profileUrl) profileUrl = a;
  }
  if (!profileUrl) {
    console.error("Usage: npm run import:calendly -- <https://calendly.com/profile-slug> [--brand <slug>] [--dry-run]");
    process.exit(1);
  }
  return { profileUrl, brandSlug, dryRun };
}

function profileSlugFrom(url: string): string {
  const u = new URL(url);
  const segment = u.pathname.split("/").filter(Boolean)[0];
  if (!segment) throw new Error(`Could not find a profile slug in "${url}"`);
  return segment;
}

// ---------------------------------------------------------------------------
// Calendly's public booking API
// ---------------------------------------------------------------------------

type CalendlyEventTypeSummary = { name: string; slug: string; uuid: string; description: string | null; color: string };

type CalendlyCustomField = {
  id: number | string;
  name: string;
  format: string;
  required: boolean;
  position: number;
  answer_choices: string[] | null;
};

type CalendlyLocationConfig = { kind: string; location: string | null };

type CalendlyEventTypeDetail = {
  name: string;
  slug: string;
  uuid: string;
  description: string | null;
  color: string;
  duration: number;
  duration_options: { duration: number; amount_cents?: number }[];
  max_booking_time: number | null;
  availability_timezone: string;
  guests_allowed: boolean;
  custom_fields: CalendlyCustomField[];
  location_configurations: CalendlyLocationConfig[];
  payment_method: { amount_cents: number; currency: string } | null;
  confirmation_page_type: string;
  redirect_configuration: { url: string } | null;
};

type CalendlySpot = { status: string; start_time: string };
type CalendlyDay = { date: string; status: string; spots: CalendlySpot[] };
type CalendlyRange = { days: CalendlyDay[] };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function fetchEventTypes(profile: string): Promise<CalendlyEventTypeSummary[]> {
  return fetchJson(`${API_BASE}/profiles/${encodeURIComponent(profile)}/event_types`);
}

async function fetchEventTypeDetail(profile: string, slug: string): Promise<CalendlyEventTypeDetail> {
  return fetchJson(
    `${API_BASE}/event_types/lookup?event_type_slug=${encodeURIComponent(slug)}&profile_slug=${encodeURIComponent(profile)}`
  );
}

async function fetchRange(uuid: string, tz: string): Promise<CalendlyRange> {
  const start = DateTime.now().setZone(tz).startOf("day");
  const end = start.plus({ days: RANGE_DAYS });
  const url =
    `${API_BASE}/event_types/${uuid}/calendar/range` +
    `?timezone=${encodeURIComponent(tz)}&range_start=${start.toFormat("yyyy-MM-dd")}&range_end=${end.toFormat("yyyy-MM-dd")}`;
  return fetchJson(url);
}

// ---------------------------------------------------------------------------
// Inference: weekly hours, increment, window type — from observed spots
// ---------------------------------------------------------------------------

type Inferred = { weeklyHours: WeeklyHours; incrementMinutes: number | null; windowType: "CALENDAR_DAYS" | "BUSINESS_DAYS"; daysInAdvance: number };

function hhmm(minutesOfDay: number): string {
  const h = Math.floor(minutesOfDay / 60) % 24;
  const m = minutesOfDay % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function inferFromRange(range: CalendlyRange, tz: string, durationMinutes: number, maxBookingTimeMinutes: number | null): Inferred {
  const startsByWeekday = new Map<number, number[]>(); // luxon weekday (1 Mon..7 Sun) -> minutes-of-day
  const diffs = new Map<number, number>(); // increment minutes -> occurrences
  let lastDate: DateTime | null = null;

  for (const day of range.days) {
    const dt = DateTime.fromISO(day.date, { zone: tz });
    if (!dt.isValid) continue;
    if (!lastDate || dt > lastDate) lastDate = dt;

    const starts = day.spots
      .filter((s) => s.status === "available")
      .map((s) => DateTime.fromISO(s.start_time, { setZone: true }).setZone(tz))
      .filter((d) => d.isValid)
      .sort((a, b) => a.toMillis() - b.toMillis());
    if (!starts.length) continue;

    const wd = dt.weekday;
    const minutes = starts.map((d) => d.hour * 60 + d.minute);
    startsByWeekday.set(wd, [...(startsByWeekday.get(wd) ?? []), ...minutes]);

    for (let i = 1; i < minutes.length; i++) {
      const d = minutes[i] - minutes[i - 1];
      if (d > 0) diffs.set(d, (diffs.get(d) ?? 0) + 1);
    }
  }

  let increment: number | null = null;
  let bestCount = 0;
  for (const [d, count] of diffs) {
    if (count > bestCount) {
      increment = d;
      bestCount = count;
    }
  }
  const effectiveIncrement = increment ?? durationMinutes;

  const weeklyHours: WeeklyHours = {};
  for (const [wd, minuteList] of startsByWeekday) {
    const earliest = Math.min(...minuteList);
    const latest = Math.max(...minuteList);
    const range: HourRange = { start: hhmm(earliest), end: hhmm(Math.min(24 * 60, latest + effectiveIncrement)) };
    // Luxon weekday: 1=Monday..7=Sunday. BookKit's WeeklyHours keys "0".."6", 0=Sunday.
    const dayKey = String(wd % 7);
    weeklyHours[dayKey] = [range];
  }

  const nominalDays = maxBookingTimeMinutes ? Math.round(maxBookingTimeMinutes / 1440) : RANGE_DAYS;
  const today = DateTime.now().setZone(tz).startOf("day");
  let windowType: "CALENDAR_DAYS" | "BUSINESS_DAYS" = "CALENDAR_DAYS";
  if (lastDate) {
    const calendarDiff = Math.round(lastDate.diff(today, "days").days);
    if (calendarDiff > nominalDays) windowType = "BUSINESS_DAYS";
  }

  return {
    weeklyHours,
    incrementMinutes: increment && increment !== durationMinutes ? increment : null,
    windowType,
    daysInAdvance: nominalDays,
  };
}

function mergeWeeklyHours(a: WeeklyHours, b: WeeklyHours): WeeklyHours {
  const out: WeeklyHours = { ...a };
  for (const [day, ranges] of Object.entries(b)) {
    if (!out[day]) {
      out[day] = ranges;
      continue;
    }
    const existing = out[day][0];
    const incoming = ranges[0];
    if (!existing || !incoming) continue;
    out[day] = [
      {
        start: incoming.start < existing.start ? incoming.start : existing.start,
        end: incoming.end > existing.end ? incoming.end : existing.end,
      },
    ];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

function htmlToMarkdown(html: string | null): string | null {
  if (!html) return null;
  let s = html;
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/p>\s*<p>/gi, "\n\n");
  s = s.replace(/<\/?p>/gi, "");
  s = s.replace(/<li>/gi, "- ").replace(/<\/li>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s || null;
}

const FIELD_FORMAT_TO_QUESTION_TYPE: Record<string, BookingQuestion["type"]> = {
  text: "long_text",
  textarea: "long_text",
  phone_number: "phone",
  select_one: "single_choice",
  select_multiple: "multi_choice",
};

function mapQuestions(fields: CalendlyCustomField[]): BookingQuestion[] {
  const raw = fields
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((f) => ({
      id: String(f.id),
      label: f.name,
      type: FIELD_FORMAT_TO_QUESTION_TYPE[f.format] ?? "long_text",
      required: Boolean(f.required),
      options: f.answer_choices ?? undefined,
    }));
  return parseQuestions(raw);
}

const LOCATION_KIND_MAP: Record<string, LocationOption["kind"]> = {
  google_conference: "google_meet",
  zoom: "link",
  ms_teams_conference: "link",
  webex_conference: "link",
  gotomeeting_conference: "link",
  outbound_call: "phone_invitee",
  inbound_call: "phone_host",
  physical: "in_person",
  custom: "custom",
};

function mapLocations(configs: CalendlyLocationConfig[]): LocationOption[] {
  const raw = configs
    .map((c): LocationOption | null => {
      const kind = LOCATION_KIND_MAP[c.kind];
      if (!kind) return null;
      return { kind, value: c.location ?? undefined };
    })
    .filter((l): l is LocationOption => l !== null);
  return parseLocations(raw);
}

// ---------------------------------------------------------------------------
// Plan + apply
// ---------------------------------------------------------------------------

type Plan = {
  slug: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  durationOptions: { minutes: number; priceCents: number | null }[];
  priceCents: number | null;
  currency: string;
  color: string;
  questions: BookingQuestion[];
  locations: LocationOption[];
  allowGuests: boolean;
  redirectUrl: string | null;
  windowType: "CALENDAR_DAYS" | "BUSINESS_DAYS";
  daysInAdvance: number;
  incrementMinutes: number | null;
  weeklyHours: WeeklyHours;
  timezone: string;
};

async function buildPlan(profile: string, summary: CalendlyEventTypeSummary): Promise<Plan> {
  const detail = await fetchEventTypeDetail(profile, summary.slug);
  const tz = detail.availability_timezone || "America/Chicago";
  const range = await fetchRange(detail.uuid, tz);
  const inferred = inferFromRange(range, tz, detail.duration, detail.max_booking_time);

  const durationOptions = (detail.duration_options ?? [])
    .map((d) => ({ minutes: Number(d.duration), priceCents: typeof d.amount_cents === "number" ? d.amount_cents : null }))
    .filter((d) => Number.isInteger(d.minutes) && d.minutes > 0 && d.minutes !== detail.duration);

  return {
    slug: detail.slug,
    name: detail.name,
    description: htmlToMarkdown(detail.description),
    durationMinutes: detail.duration,
    durationOptions,
    priceCents: detail.payment_method?.amount_cents ?? null,
    currency: (detail.payment_method?.currency || "usd").toLowerCase(),
    color: /^#[0-9a-fA-F]{6}$/.test(detail.color) ? detail.color : "#FF6A00",
    questions: mapQuestions(detail.custom_fields ?? []),
    locations: mapLocations(detail.location_configurations ?? []),
    allowGuests: detail.guests_allowed,
    redirectUrl: detail.confirmation_page_type === "external" ? (detail.redirect_configuration?.url ?? null) : null,
    windowType: inferred.windowType,
    daysInAdvance: inferred.daysInAdvance,
    incrementMinutes: inferred.incrementMinutes,
    weeklyHours: inferred.weeklyHours,
    timezone: tz,
  };
}

function printPlan(plan: Plan) {
  console.log(`\n/${plan.slug} — "${plan.name}"`);
  console.log(`  duration: ${plan.durationMinutes} min${plan.durationOptions.length ? ` (+${plan.durationOptions.map((d) => d.minutes).join("/")} min)` : ""}`);
  console.log(`  price: ${plan.priceCents ? `${(plan.priceCents / 100).toFixed(2)} ${plan.currency.toUpperCase()}` : "free"}`);
  console.log(`  window: ${plan.windowType} x ${plan.daysInAdvance}`);
  console.log(`  increment: ${plan.incrementMinutes ?? plan.durationMinutes} min`);
  console.log(`  timezone: ${plan.timezone}`);
  console.log(`  locations: ${plan.locations.map((l) => l.kind).join(", ")}`);
  console.log(`  questions: ${plan.questions.length}`);
  console.log(`  guests allowed: ${plan.allowGuests}`);
  console.log(`  weekly hours: ${JSON.stringify(plan.weeklyHours)}`);
}

async function main() {
  const { profileUrl, brandSlug, dryRun } = parseArgs(process.argv.slice(2));
  const profile = profileSlugFrom(profileUrl);
  console.log(`Fetching event types for calendly.com/${profile}...`);

  const summaries = await fetchEventTypes(profile);
  if (!summaries.length) {
    console.log("No public event types found on that profile.");
    return;
  }

  const plans: Plan[] = [];
  for (const s of summaries) {
    console.log(`  - ${s.slug}...`);
    plans.push(await buildPlan(profile, s));
  }

  if (dryRun) {
    console.log(`\nDRY RUN — ${plans.length} event type(s) would be imported. Nothing was written.`);
    plans.forEach(printPlan);
    return;
  }

  const host = await prisma.host.findFirst({ orderBy: { createdAt: "asc" } });
  if (!host) throw new Error("No host found — run `npm run seed` first.");

  let brand = null as Awaited<ReturnType<typeof prisma.brand.findFirst>>;
  if (brandSlug) {
    brand = await prisma.brand.findFirst({ where: { hostId: host.id, slug: brandSlug } });
    if (!brand) console.warn(`--brand "${brandSlug}" not found — importing without a brand. Create it in /admin first.`);
  }

  let mergedHours: WeeklyHours = {};
  for (const p of plans) mergedHours = mergeWeeklyHours(mergedHours, p.weeklyHours);
  const scheduleTimezone = plans[0]?.timezone || "America/Chicago";

  let schedule = await prisma.schedule.findFirst({ where: { hostId: host.id, name: SCHEDULE_NAME } });
  if (schedule) {
    schedule = await prisma.schedule.update({ where: { id: schedule.id }, data: { weeklyHours: mergedHours, timezone: scheduleTimezone } });
    console.log(`updated schedule "${SCHEDULE_NAME}"`);
  } else {
    schedule = await prisma.schedule.create({
      data: { hostId: host.id, name: SCHEDULE_NAME, timezone: scheduleTimezone, weeklyHours: mergedHours },
    });
    console.log(`created schedule "${SCHEDULE_NAME}"`);
  }

  for (const p of plans) {
    const data = {
      hostId: host.id,
      brandId: brand?.id ?? null,
      scheduleId: schedule.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      durationMinutes: p.durationMinutes,
      durationOptions: p.durationOptions.length ? p.durationOptions : undefined,
      priceCents: p.priceCents,
      currency: p.currency,
      color: p.color,
      windowType: p.windowType,
      daysInAdvance: p.daysInAdvance,
      startIncrementMinutes: p.incrementMinutes,
      questions: p.questions.length ? p.questions : undefined,
      locations: p.locations,
      allowGuests: p.allowGuests,
      redirectUrl: p.redirectUrl,
      // Not observable from Calendly's public API — every import discovers only
      // public links, so nothing found here can be secret by definition.
      secret: false,
      active: true,
    };
    const existing = await prisma.meetingType.findUnique({ where: { slug: p.slug } });
    if (existing) {
      await prisma.meetingType.update({ where: { slug: p.slug }, data });
      console.log(`updated /${p.slug}`);
    } else {
      await prisma.meetingType.create({ data });
      console.log(`created /${p.slug}`);
    }
  }

  console.log(`\nImported ${plans.length} event type(s). Review minimum notice, buffers and limits in /admin — Calendly's public API doesn't expose them.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
