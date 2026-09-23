/**
 * What each outbox job does. Imported lazily by drainJobs so the jobs module has
 * no static dependency on the booking engine.
 */
import type { Job } from "@prisma/client";
import { prisma } from "./db";
import { calendar } from "./calendar";
import { PermanentJobError, registerJobHandler } from "./jobs";
import { loadCtx, refundBooking, writeCalendarEvent } from "./booking";
import { deliverWebhook } from "./webhooks";
import {
  sendCancellation,
  sendConflictApology,
  sendFollowUp,
  sendHostNotification,
  sendInviteeConfirmation,
  sendReminder,
  sendRescheduled,
} from "./emails";
import { audit } from "./audit";
import { env, hasResend } from "./env";

function needBooking(job: Job): string {
  if (!job.bookingId) throw new PermanentJobError(`${job.kind} job has no booking`);
  return job.bookingId;
}

async function ctxOrStop(job: Job) {
  try {
    return await loadCtx(needBooking(job));
  } catch {
    throw new PermanentJobError("booking no longer exists");
  }
}

/** Thrown to finish an email job without sending (no provider configured). */
class MailSkipped extends Error {}

/**
 * A send that returned false while a provider IS configured is a real failure and
 * retries. With no provider at all there is nothing to retry: the job completes as
 * skipped (the canary raises one "email not configured" alert instead of one per job).
 */
async function mustSend(send: () => Promise<boolean>, what: string) {
  if (!hasResend() || !env("RESEND_FROM")) throw new MailSkipped(what);
  if (!(await send())) throw new Error(`${what}: mail provider refused or failed`);
}

registerJobHandler("calendar.create", async (job) => {
  const ctx = await ctxOrStop(job);
  if (ctx.booking.status !== "CONFIRMED" || ctx.booking.googleEventId) return;
  await writeCalendarEvent(ctx.booking.id);
});

registerJobHandler("calendar.update", async (job) => {
  const { booking, host } = await ctxOrStop(job);
  if (booking.status !== "CONFIRMED" || !booking.googleEventId) return;
  await calendar().updateEvent(host, booking.googleEventId, { startTime: booking.startTime, endTime: booking.endTime });
  await audit(booking.id, "calendar_updated", { via: "job" });
});

registerJobHandler("calendar.delete", async (job) => {
  const { booking, host } = await ctxOrStop(job);
  const eventId = (job.payload as { eventId?: string }).eventId;
  if (!eventId) return;
  await calendar().deleteEvent(host, eventId);
  await audit(booking.id, "calendar_deleted", { via: "job" });
});

function skippable(fn: (job: Job) => Promise<void>) {
  return async (job: Job) => {
    try {
      await fn(job);
    } catch (err) {
      if (err instanceof MailSkipped) {
        if (job.bookingId) await audit(job.bookingId, "email_skipped", { what: err.message, why: "mail not configured" });
        return;
      }
      throw err;
    }
  };
}

registerJobHandler("email", skippable(async (job) => {
  const ctx = { ...(await ctxOrStop(job)), mailKey: `job:${job.id}` };
  const p = job.payload as { template?: string; refunded?: boolean };
  switch (p.template) {
    case "confirmation":
      if (ctx.booking.status !== "CONFIRMED") return;
      await mustSend(() => sendInviteeConfirmation(ctx), "confirmation");
      await prisma.booking.update({ where: { id: ctx.booking.id }, data: { confirmationEmailSentAt: new Date(), confirmationEmailError: null } });
      break;
    case "host_new":
      await mustSend(() => sendHostNotification(ctx), "host notification");
      break;
    case "cancelled_invitee":
      await mustSend(() => sendCancellation(ctx, "invitee"), "cancellation");
      break;
    case "cancelled_host":
      await mustSend(() => sendCancellation(ctx, "host"), "cancellation (host)");
      break;
    case "rescheduled_invitee":
      if (ctx.booking.status !== "CONFIRMED") return;
      await mustSend(() => sendRescheduled(ctx, "invitee"), "reschedule");
      break;
    case "rescheduled_host":
      if (ctx.booking.status !== "CONFIRMED") return;
      await mustSend(() => sendRescheduled(ctx, "host"), "reschedule (host)");
      break;
    case "conflict_apology":
      await mustSend(() => sendConflictApology(ctx, Boolean(p.refunded)), "conflict apology");
      break;
    default:
      throw new PermanentJobError(`unknown email template ${p.template}`);
  }
  await audit(ctx.booking.id, "email_sent", { template: p.template });
}));

registerJobHandler("reminder", skippable(async (job) => {
  const ctx = { ...(await ctxOrStop(job)), mailKey: `job:${job.id}` };
  const p = job.payload as { minutes: number; startTime: string };
  const { booking } = ctx;
  // Stale: cancelled, rescheduled since, or already started.
  if (booking.status !== "CONFIRMED") return;
  if (booking.startTime.toISOString() !== p.startTime) return;
  if (booking.startTime.getTime() <= Date.now()) return;
  await mustSend(() => sendReminder(ctx, p.minutes), "reminder");
  await audit(booking.id, "reminder_sent", { minutes: p.minutes });
}));

registerJobHandler("followup", skippable(async (job) => {
  const ctx = { ...(await ctxOrStop(job)), mailKey: `job:${job.id}` };
  const p = job.payload as { startTime: string };
  if (ctx.booking.status !== "CONFIRMED" || ctx.booking.noShow) return;
  if (ctx.booking.startTime.toISOString() !== p.startTime) return;
  await mustSend(() => sendFollowUp(ctx), "follow-up");
  await audit(ctx.booking.id, "followup_sent");
}));

registerJobHandler("webhook", async (job) => {
  await deliverWebhook(job.payload as { endpointId: string | null; url: string; body: unknown });
});

registerJobHandler("refund", async (job) => {
  const p = job.payload as { reason?: string };
  const ok = await refundBooking(needBooking(job), p.reason ?? "cancelled");
  if (!ok) throw new PermanentJobError("booking has no captured payment to refund");
});
