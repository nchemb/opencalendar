import { prisma } from "./db";
import { getHost, hostBookingBlocked } from "./booking";
import { lastTickAt } from "./cron";
import { env, hasResend, isDemoMode } from "./env";
import { stripeConfigured, stripeKeyMismatch } from "./stripe";

export type Check = { ok: boolean; detail: string };
export type Health = { ok: boolean; checks: Record<string, Check> };

/** One place that answers "can this instance take bookings right now?" */
export async function health(): Promise<Health> {
  const checks: Record<string, Check> = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true, detail: "reachable" };
  } catch {
    checks.database = { ok: false, detail: "unreachable" };
    return { ok: false, checks };
  }

  const host = await getHost();
  if (!host) {
    checks.setup = { ok: false, detail: "no host row — run npm run setup" };
  } else if (isDemoMode()) {
    checks.calendar = { ok: true, detail: "demo mode (in-memory calendar)" };
  } else {
    checks.calendar = hostBookingBlocked(host)
      ? { ok: false, detail: host.googleAuthError ? "Google rejected the connection — reconnect in /admin/settings" : "Google Calendar not connected" }
      : { ok: true, detail: "connected" };
  }

  const tickAt = await lastTickAt();
  const ageMin = tickAt ? Math.round((Date.now() - tickAt) / 60_000) : null;
  checks.cron = tickAt && ageMin! <= 30
    ? { ok: true, detail: `last tick ${ageMin} min ago` }
    : { ok: false, detail: tickAt ? `last tick ${ageMin} min ago — retries and reminders are stalled` : "never ran — schedule /api/cron/tick (docs/RELIABILITY.md)" };

  const [pending, dead, critical] = await Promise.all([
    prisma.job.count({ where: { doneAt: null, deadAt: null, runAt: { lte: new Date(Date.now() - 15 * 60_000) } } }),
    prisma.job.count({ where: { deadAt: { not: null }, doneAt: null } }),
    prisma.alert.count({ where: { resolvedAt: null, severity: "critical" } }),
  ]);
  checks.outbox = pending === 0 && dead === 0
    ? { ok: true, detail: "no overdue or failed tasks" }
    : { ok: false, detail: `${pending} overdue, ${dead} failed` };
  checks.alerts = critical === 0 ? { ok: true, detail: "no open critical alerts" } : { ok: false, detail: `${critical} open critical alert(s)` };

  checks.email = hasResend() && env("RESEND_FROM")
    ? { ok: true, detail: "configured" }
    : { ok: false, detail: "not configured — no confirmation/reminder emails" };
  if (stripeConfigured()) {
    const mismatch = stripeKeyMismatch();
    checks.payments = mismatch ? { ok: false, detail: mismatch } : { ok: true, detail: "configured" };
  }

  // Email is a warning, not an outage: Google's invite still reaches the invitee.
  const hard = ["database", "setup", "calendar", "cron", "outbox", "alerts", "payments"];
  const okAll = hard.every((k) => !checks[k] || checks[k].ok);
  return { ok: okAll, checks };
}
