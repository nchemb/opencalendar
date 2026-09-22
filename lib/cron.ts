/**
 * The periodic tick. Anything can call it (Vercel Cron, GitHub Actions, a crontab
 * on a box you own, an uptime monitor) — see docs/RELIABILITY.md. Every task is
 * idempotent, so overlapping or missed ticks are harmless.
 */
import { timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { drainJobs, type DrainResult } from "./jobs";
import { errorMessage, log } from "./logger";
import { getAvailability, meetingTypeInclude, pausedMessage } from "./availability";
import { calendar } from "./calendar";
import { raiseAlert, resolveAlert } from "./alerts";
import { getHost, hostBookingBlocked, syncPaymentFromStripe } from "./booking";
import { appUrl, env, fakeCalendarInProduction, hasResend, isDemoMode } from "./env";
import { stripeConfigured } from "./stripe";

/**
 * "Not paid" including NULL. Prisma's `{ not: "paid" }` compiles to `<> 'paid'`,
 * which is false for NULL — a hold that died before its payment started would
 * never be swept and would burn its slot forever.
 */
const UNPAID = [{ stripePaymentStatus: null }, { stripePaymentStatus: { not: "paid" } }];

const CANARY_EVERY_MS = 30 * 60_000;
const RECONCILE_EVERY_MS = 30 * 60_000;

async function getMark(key: string): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  return row ? Number(row.value) || 0 : 0;
}

async function setMark(key: string, value = Date.now()) {
  await prisma.setting
    .upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } })
    .catch(() => undefined);
}

export async function lastTickAt(): Promise<number> {
  return getMark("CRON_LAST_TICK");
}

/** Release unpaid holds whose expiry has passed, across all hosts. */
async function sweepHolds(): Promise<number> {
  const res = await prisma.booking.updateMany({
    where: { status: "PENDING_PAYMENT", expiresAt: { lte: new Date() }, OR: UNPAID },
    data: { status: "EXPIRED", expiresAt: null },
  });
  return res.count;
}

/** Holds with a started payment but no webhook yet: ask Stripe directly. */
async function syncStuckPayments(): Promise<number> {
  if (!stripeConfigured()) return 0;
  const since = new Date(Date.now() - 3 * 3_600_000);
  const until = new Date(Date.now() - 90_000);
  const rows = await prisma.booking.findMany({
    where: {
      webhookProcessedAt: null,
      createdAt: { gte: since, lte: until },
      OR: [{ stripePaymentIntentId: { not: null } }, { stripeSessionId: { not: null } }],
      status: { in: ["PENDING_PAYMENT", "EXPIRED"] },
    },
    select: { id: true },
    take: 20,
  });
  for (const r of rows) {
    await syncPaymentFromStripe(r.id).catch((err) =>
      log.warn("cron", "payment_sync_failed", { bookingId: r.id, error: errorMessage(err) })
    );
  }
  return rows.length;
}

/**
 * Canary: every public link must be able to read the calendar and offer at least
 * one slot in its window. "Zero slots for a whole week" is the silent failure that
 * costs bookings without anyone noticing.
 */
export async function runCanary(): Promise<{ checked: number; problems: string[] }> {
  const host = await getHost();
  const problems: string[] = [];
  if (!host) return { checked: 0, problems };

  if (fakeCalendarInProduction()) {
    await raiseAlert({
      kind: "fake_calendar",
      severity: "critical",
      title: "BOOKKIT_CALENDAR=memory is set in production",
      message: "Bookings are being written to an in-memory test calendar, not Google. Remove BOOKKIT_CALENDAR from your production environment and redeploy.",
      key: "fake_calendar",
    }, host);
    problems.push("fake calendar in production");
  }

  if (hostBookingBlocked(host)) {
    problems.push("calendar not connected");
    // The disconnect alert is raised where the failure happens; nothing to add.
    return { checked: 0, problems };
  }

  if (!hasResend() && !isDemoMode()) {
    await raiseAlert({
      kind: "email_not_configured",
      severity: "warning",
      title: "Email is not configured",
      message:
        "RESEND_API_KEY / RESEND_FROM are not set, so invitees get no confirmation or reminder emails from BookKit (Google still sends its invite) and alerts only reach this dashboard. Set ALERT_WEBHOOK_URL too if you want push alerts.",
      key: "email_not_configured",
    });
  } else {
    await resolveAlert("email_not_configured");
  }

  const types = await prisma.meetingType.findMany({
    where: { active: true, secret: false },
    include: meetingTypeInclude,
  });
  const paused = Boolean(pausedMessage(host));
  const now = new Date();
  const horizon = new Date(now.getTime() + 60 * 86_400_000);

  for (const mt of types) {
    const key = `no_slots:${mt.id}`;
    try {
      const slots = await getAvailability(host, mt, now, horizon, { now });
      if (!slots.length && !paused) {
        await raiseAlert(
          {
            kind: "no_slots",
            severity: "warning",
            title: `/${mt.slug} has no open slots`,
            message: `Nobody can book "${mt.name}" right now: its whole booking window is full or closed. If that's not intended, check the schedule, date overrides, limits and your calendar.`,
            key,
            cta: `${appUrl()}/admin/availability?type=${mt.id}`,
          },
          host
        );
        problems.push(`${mt.slug}: no slots`);
      } else {
        await resolveAlert(key);
      }
      await resolveAlert(`availability_error:${mt.id}`);
    } catch (err) {
      problems.push(`${mt.slug}: ${errorMessage(err)}`);
      await raiseAlert(
        {
          kind: "availability_error",
          severity: "critical",
          title: `/${mt.slug} can't load availability`,
          message: `The booking page is showing no times because the calendar could not be read.\nError: ${errorMessage(err).slice(0, 300)}`,
          key: `availability_error:${mt.id}`,
        },
        host
      );
    }
  }
  return { checked: types.length, problems };
}

/**
 * Reconcile: every upcoming confirmed booking's calendar event must still exist at
 * the same time. Detect only — a host deleting an event by hand might be a mistake,
 * so they decide (cancel & notify, or ignore) from the alert.
 */
export async function runReconcile(): Promise<{ checked: number; drifted: number }> {
  const host = await getHost();
  if (!host || hostBookingBlocked(host)) return { checked: 0, drifted: 0 };
  const rows = await prisma.booking.findMany({
    where: {
      hostId: host.id,
      status: "CONFIRMED",
      googleEventId: { not: null },
      startTime: { gte: new Date(), lte: new Date(Date.now() + 45 * 86_400_000) },
    },
    orderBy: { startTime: "asc" },
    take: 100,
  });
  let drifted = 0;
  for (const b of rows) {
    const key = `calendar_drift:${b.id}`;
    try {
      const ev = await calendar().getEvent(host, b.googleEventId!);
      const gone = !ev || ev.cancelled;
      const moved =
        ev && !ev.cancelled && ev.start && ev.start.getTime() !== b.startTime.getTime();
      if (gone || moved) {
        drifted++;
        await raiseAlert(
          {
            kind: "calendar_drift",
            severity: "warning",
            title: gone
              ? `A booked meeting was deleted from your calendar (${b.name})`
              : `A booked meeting was moved in your calendar (${b.name})`,
            message: gone
              ? `${b.name} <${b.email}> is still booked for ${b.startTime.toISOString()} (UTC) but the calendar event is gone. Cancel the booking (and notify them) or restore the event.`
              : `${b.name}'s booking says ${b.startTime.toISOString()} but the calendar event is at ${ev!.start!.toISOString()}. Reschedule the booking so they get the right time.`,
            bookingId: b.id,
            key,
            cta: `${appUrl()}/admin/bookings/${b.id}`,
          },
          host
        );
      } else {
        await resolveAlert(key);
      }
    } catch (err) {
      log.warn("cron", "reconcile_failed", { bookingId: b.id, error: errorMessage(err) });
      break; // calendar trouble: the canary reports it; don't hammer the API
    }
  }
  return { checked: rows.length, drifted };
}

export type TickResult = {
  jobs: DrainResult;
  holdsReleased: number;
  paymentsSynced: number;
  canary?: { checked: number; problems: string[] };
  reconcile?: { checked: number; drifted: number };
};

export async function tick(opts: { budgetMs?: number; force?: boolean } = {}): Promise<TickResult> {
  const started = Date.now();
  await setMark("CRON_LAST_TICK", started);
  const holdsReleased = await sweepHolds();
  const paymentsSynced = await syncStuckPayments();
  const jobs = await drainJobs({ budgetMs: Math.max(5_000, (opts.budgetMs ?? 40_000) / 2) });

  const result: TickResult = { jobs, holdsReleased, paymentsSynced };
  if (opts.force || started - (await getMark("CRON_LAST_CANARY")) > CANARY_EVERY_MS) {
    await setMark("CRON_LAST_CANARY", started);
    result.canary = await runCanary().catch((err) => ({ checked: 0, problems: [errorMessage(err)] }));
  }
  if (opts.force || started - (await getMark("CRON_LAST_RECONCILE")) > RECONCILE_EVERY_MS) {
    await setMark("CRON_LAST_RECONCILE", started);
    result.reconcile = await runReconcile().catch(() => ({ checked: 0, drifted: 0 }));
  }
  log.info("cron", "tick", { ...result, ms: Date.now() - started });
  return result;
}

/** Who may trigger the tick: Vercel Cron's header, or `Authorization: Bearer $CRON_SECRET`. */
export function cronAuthorized(req: Request): boolean {
  const secret = env("CRON_SECRET");
  const auth = req.headers.get("authorization");
  // Header only: a secret in the query string ends up in access logs.
  if (!secret || !auth) return false;
  const a = Buffer.from(auth);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
