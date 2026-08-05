import { Prisma, type Booking, type Host, type MeetingType } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "./db";
import { appUrl } from "./env";
import { isSlotOnGrid } from "./availability";
import {
  GoogleApiError,
  GoogleAuthError,
  createEventWithRetry,
  deleteEvent,
  freeBusy,
} from "./google";
import { errorMessage, log } from "./logger";
import { stripe } from "./stripe";
import { deliverBookingWebhook } from "./outbound-webhook";
import {
  formatWhen,
  sendBookingConfirmation,
  sendCancellationEmails,
  sendConflictApology,
  sendManualFollowUpNotice,
} from "./booking-emails";
import { sendCalendarFailureAlert, sendConflictRefundAlert } from "./alerts";

/** The slot is gone. Surfaced to the booker as a clean 409. */
export class SlotTakenError extends Error {
  code = "SLOT_TAKEN";
  constructor(message = "That time was just taken. Pick another slot.") {
    super(message);
    this.name = "SlotTakenError";
  }
}

/** Not a real slot for this meeting type (off-grid, too soon, too far out). */
export class InvalidSlotError extends Error {
  code = "INVALID_SLOT";
  constructor(message = "That time is not available for this meeting type.") {
    super(message);
    this.name = "InvalidSlotError";
  }
}

/** Booking is impossible right now (Google disconnected or unreachable). Fail closed. */
export class BookingUnavailableError extends Error {
  code = "UNAVAILABLE";
  constructor(message = "Booking is temporarily unavailable. Please try again shortly.") {
    super(message);
    this.name = "BookingUnavailableError";
  }
}

/** Free bookings hold the slot only for as long as the Google call needs. */
const FREE_HOLD_MINUTES = 5;
/** Our DB hold must outlive the Stripe session so payment can never land on a released slot. */
const PAID_HOLD_MINUTES = 33;
const STRIPE_SESSION_MINUTES = 31; // Stripe requires >= 30

export async function getHost(): Promise<Host | null> {
  return prisma.host.findFirst({ orderBy: { createdAt: "asc" } });
}

export async function requireHost(): Promise<Host> {
  const host = await getHost();
  if (!host) throw new BookingUnavailableError("This BookKit instance is not set up yet.");
  return host;
}

type TxClient = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Runs fn inside a Serializable transaction that first takes a Postgres advisory lock
 * keyed on the host. The lock is what actually serializes competing bookers: it holds
 * across the Google freebusy round-trip, which no isolation level can do on its own.
 * Retries on serialization failures.
 */
async function withHostLock<T>(hostId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${hostId}))`;
          return fn(tx as TxClient);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 20_000,
          maxWait: 10_000,
        }
      );
    } catch (err) {
      const code = (err as { code?: string })?.code;
      // P2034: write conflict / deadlock — safe to retry the whole transaction.
      if (code === "P2034" && attempt < 3) {
        lastErr = err;
        log.warn("booking", "tx_retry", { hostId, attempt });
        await new Promise((r) => setTimeout(r, 120 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function overlapsInTx(
  tx: TxClient,
  hostId: string,
  startTime: Date,
  endTime: Date,
  now: Date,
  excludeBookingId?: string
): Promise<Booking | null> {
  return tx.booking.findFirst({
    where: {
      hostId,
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      startTime: { lt: endTime },
      endTime: { gt: startTime },
      OR: [
        { status: "CONFIRMED" },
        { status: "PENDING_PAYMENT", expiresAt: { gt: now } },
      ],
    },
  });
}

async function dailyLimitReachedInTx(
  tx: TxClient,
  meetingType: MeetingType,
  hostTimezone: string,
  startTime: Date,
  now: Date
): Promise<boolean> {
  if (!meetingType.dailyLimit || meetingType.dailyLimit <= 0) return false;
  const day = DateTime.fromJSDate(startTime, { zone: hostTimezone });
  const dayStart = day.startOf("day").toUTC().toJSDate();
  const dayEnd = day.endOf("day").toUTC().toJSDate();

  const count = await tx.booking.count({
    where: {
      meetingTypeId: meetingType.id,
      startTime: { gte: dayStart, lte: dayEnd },
      OR: [
        { status: "CONFIRMED" },
        { status: "PENDING_PAYMENT", expiresAt: { gt: now } },
      ],
    },
  });
  return count >= meetingType.dailyLimit;
}

export type BookingInput = {
  name: string;
  email: string;
  timezone: string;
  customAnswer?: string | null;
  startTime: Date;
};

/**
 * Atomically claim a slot. Validates grid legality, DB overlaps (including unexpired
 * holds) and live Google freebusy, then inserts the row — all under the host lock.
 */
async function reserveSlot(
  host: Host,
  meetingType: MeetingType,
  input: BookingInput,
  holdMinutes: number,
  amountCents: number | null
): Promise<Booking> {
  const now = new Date();
  const startTime = input.startTime;
  const endTime = new Date(startTime.getTime() + meetingType.durationMinutes * 60_000);

  if (!isSlotOnGrid(meetingType, host.timezone, startTime, now)) {
    throw new InvalidSlotError();
  }

  const bufferMs = meetingType.bufferMinutes * 60_000;
  const guardStart = new Date(startTime.getTime() - bufferMs);
  const guardEnd = new Date(endTime.getTime() + bufferMs);

  try {
    return await withHostLock(host.id, async (tx) => {
      const clash = await overlapsInTx(tx, host.id, guardStart, guardEnd, now);
      if (clash) throw new SlotTakenError();

      if (await dailyLimitReachedInTx(tx, meetingType, host.timezone, startTime, now)) {
        throw new SlotTakenError("No more bookings are available that day.");
      }

      // Live re-check against the real calendar, inside the lock: catches events the
      // host added by hand since the page was rendered.
      const busy = await freeBusy(host, guardStart, guardEnd);
      const busyClash = busy.some(
        (b) => b.start.getTime() < guardEnd.getTime() && b.end.getTime() > guardStart.getTime()
      );
      if (busyClash) throw new SlotTakenError();

      return tx.booking.create({
        data: {
          hostId: host.id,
          meetingTypeId: meetingType.id,
          name: input.name,
          email: input.email,
          timezone: input.timezone,
          customAnswer: input.customAnswer ?? null,
          startTime,
          endTime,
          status: "PENDING_PAYMENT",
          amountCents,
          expiresAt: new Date(now.getTime() + holdMinutes * 60_000),
        },
      });
    });
  } catch (err) {
    if (err instanceof GoogleAuthError || err instanceof GoogleApiError) {
      // Fail closed — never book blind against an unreadable calendar.
      log.error("booking", "freebusy_failed_fail_closed", { error: errorMessage(err) });
      throw new BookingUnavailableError();
    }
    // Partial unique index race: another request won the exact same slot.
    if ((err as { code?: string })?.code === "P2002") throw new SlotTakenError();
    throw err;
  }
}

/**
 * Promote a held booking to CONFIRMED by writing the Google Calendar event.
 * A booking is never CONFIRMED without an event id — that is the core invariant.
 */
async function confirmWithCalendar(
  booking: Booking,
  meetingType: MeetingType,
  host: Host
): Promise<Booking> {
  const paid = booking.stripePaymentStatus === "paid";

  try {
    const event = await createEventWithRetry(host, {
      bookingId: booking.id,
      summary: `${meetingType.name} — ${booking.name}`,
      description: buildEventDescription(booking, meetingType),
      startTime: booking.startTime,
      endTime: booking.endTime,
      attendeeEmail: booking.email,
      attendeeName: booking.name,
    });

    const confirmed = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "CONFIRMED",
        googleEventId: event.eventId,
        googleEventAt: new Date(),
        meetLink: event.meetLink,
        googleSyncError: null,
        expiresAt: null,
      },
    });

    log.info("booking", "confirmed", {
      bookingId: confirmed.id,
      eventId: event.eventId,
      paid,
    });

    await runSideEffects(confirmed, meetingType, host);
    return confirmed;
  } catch (err) {
    const reason = errorMessage(err);
    const failed = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "FAILED_NEEDS_INTERVENTION",
        googleSyncError: reason.slice(0, 1000),
        retryCount: { increment: 1 },
        lastRetryAt: new Date(),
        expiresAt: null,
      },
    });

    log.error("booking", "calendar_failed", {
      bookingId: failed.id,
      paid,
      error: reason,
    });

    await sendCalendarFailureAlert({ ...failed, meetingType }, host, reason);
    await sendManualFollowUpNotice(failed, meetingType, host).catch(() => undefined);
    throw err;
  }
}

function buildEventDescription(booking: Booking, meetingType: MeetingType): string {
  const lines = [
    `Booked via BookKit — ${appUrl()}/${meetingType.slug}`,
    "",
    `Name: ${booking.name}`,
    `Email: ${booking.email}`,
    `Their timezone: ${booking.timezone}`,
  ];
  if (meetingType.customQuestion && booking.customAnswer) {
    lines.push("", meetingType.customQuestion, booking.customAnswer);
  }
  if (booking.amountCents) {
    lines.push("", `Paid: ${(booking.amountCents / 100).toFixed(2)} ${meetingType.currency.toUpperCase()}`);
  }
  lines.push("", `Cancel: ${appUrl()}/cancel/${booking.cancelToken}`);
  return lines.join("\n");
}

/** Email + outbound webhook. Both are non-fatal: the booking already stands. */
async function runSideEffects(booking: Booking, meetingType: MeetingType, host: Host) {
  const results = await Promise.allSettled([
    sendBookingConfirmation(booking, meetingType, host),
    deliverBookingWebhook(booking, meetingType),
  ]);

  const mail = results[0];
  if (mail.status === "fulfilled" && mail.value) {
    await prisma.booking
      .update({ where: { id: booking.id }, data: { confirmationEmailSentAt: new Date() } })
      .catch(() => undefined);
  } else {
    const reason = mail.status === "rejected" ? errorMessage(mail.reason) : "resend not configured";
    await prisma.booking
      .update({ where: { id: booking.id }, data: { confirmationEmailError: reason.slice(0, 500) } })
      .catch(() => undefined);
  }
}

/** Free meeting type: reserve, then confirm with the calendar event. */
export async function createFreeBooking(
  host: Host,
  meetingType: MeetingType,
  input: BookingInput
): Promise<Booking> {
  const booking = await reserveSlot(host, meetingType, input, FREE_HOLD_MINUTES, null);
  return confirmWithCalendar(booking, meetingType, host);
}

/** Paid meeting type: reserve a hold, then hand back a Stripe Checkout URL. */
export async function startPaidCheckout(
  host: Host,
  meetingType: MeetingType,
  input: BookingInput
): Promise<{ booking: Booking; checkoutUrl: string }> {
  if (!meetingType.priceCents || meetingType.priceCents <= 0) {
    throw new InvalidSlotError("This meeting type is free — no payment needed.");
  }

  const booking = await reserveSlot(
    host,
    meetingType,
    input,
    PAID_HOLD_MINUTES,
    meetingType.priceCents
  );

  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      customer_email: booking.email,
      client_reference_id: booking.id,
      expires_at: Math.floor(Date.now() / 1000) + STRIPE_SESSION_MINUTES * 60,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: meetingType.currency,
            unit_amount: meetingType.priceCents,
            product_data: {
              name: meetingType.name,
              description: formatWhen(booking.startTime, booking.timezone),
            },
          },
        },
      ],
      metadata: {
        bookingId: booking.id,
        meetingTypeSlug: meetingType.slug,
        startTime: booking.startTime.toISOString(),
      },
      payment_intent_data: {
        metadata: { bookingId: booking.id },
      },
      success_url: `${appUrl()}/success?booking=${booking.id}`,
      cancel_url: `${appUrl()}/${meetingType.slug}?cancelled=1`,
    });

    if (!session.url) throw new Error("Stripe returned no checkout URL");

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { stripeSessionId: session.id, stripePaymentStatus: "unpaid" },
    });

    log.info("booking", "checkout_started", { bookingId: booking.id, sessionId: session.id });
    return { booking: updated, checkoutUrl: session.url };
  } catch (err) {
    // Could not start payment — release the hold immediately.
    await prisma.booking
      .update({ where: { id: booking.id }, data: { status: "EXPIRED", expiresAt: null } })
      .catch(() => undefined);
    log.error("booking", "checkout_failed", {
      bookingId: booking.id,
      error: errorMessage(err),
    });
    throw err;
  }
}

/**
 * Stripe `checkout.session.completed`. Idempotent: the first delivery claims the
 * booking with a conditional update; later deliveries are no-ops.
 */
export async function finalizePaidBooking(session: {
  id: string;
  payment_intent: string | null;
  payment_status: string | null;
  amount_total: number | null;
}): Promise<void> {
  const existing = await prisma.booking.findUnique({
    where: { stripeSessionId: session.id },
    include: { meetingType: true, host: true },
  });

  if (!existing) {
    log.warn("stripe-webhook", "unknown_session", { sessionId: session.id });
    return;
  }

  // Atomic claim — only one delivery gets past this.
  const claimed = await prisma.booking.updateMany({
    where: { id: existing.id, webhookProcessedAt: null },
    data: {
      webhookProcessedAt: new Date(),
      stripePaymentStatus: "paid",
      stripePaidAt: new Date(),
      stripePaymentIntentId: session.payment_intent,
      amountCents: session.amount_total ?? existing.amountCents,
    },
  });

  if (claimed.count === 0) {
    log.info("stripe-webhook", "duplicate_ignored", {
      sessionId: session.id,
      bookingId: existing.id,
      status: existing.status,
    });
    return;
  }

  if (existing.status === "CONFIRMED" && existing.googleEventId) return;

  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: existing.id } });
  const { meetingType, host } = existing;

  // Payment landed — did anything steal the slot in the meantime?
  const conflict = await findPostPaymentConflict(booking, meetingType, host);
  if (conflict) {
    await handlePostPaymentConflict(booking, meetingType, host, conflict);
    return;
  }

  try {
    await confirmWithCalendar(booking, meetingType, host);
  } catch {
    // confirmWithCalendar already marked FAILED_NEEDS_INTERVENTION and alerted.
  }
}

/**
 * Conflict detection at webhook time. Deliberately overlap-only: min-notice may have
 * elapsed during checkout and that must never trigger a refund. A freebusy *error*
 * is never treated as a conflict either — we only refund on positive evidence.
 */
async function findPostPaymentConflict(
  booking: Booking,
  meetingType: MeetingType,
  host: Host
): Promise<string | null> {
  const now = new Date();
  const bufferMs = meetingType.bufferMinutes * 60_000;
  const guardStart = new Date(booking.startTime.getTime() - bufferMs);
  const guardEnd = new Date(booking.endTime.getTime() + bufferMs);

  const dbClash = await prisma.booking.findFirst({
    where: {
      hostId: booking.hostId,
      id: { not: booking.id },
      startTime: { lt: guardEnd },
      endTime: { gt: guardStart },
      OR: [
        { status: "CONFIRMED" },
        { status: "PENDING_PAYMENT", expiresAt: { gt: now } },
      ],
    },
    select: { id: true },
  });
  if (dbClash) return `overlapping booking ${dbClash.id}`;

  try {
    const busy = await freeBusy(host, guardStart, guardEnd);
    const clash = busy.find(
      (b) => b.start.getTime() < guardEnd.getTime() && b.end.getTime() > guardStart.getTime()
    );
    if (clash) {
      return `calendar busy ${clash.start.toISOString()}–${clash.end.toISOString()}`;
    }
  } catch (err) {
    log.warn("stripe-webhook", "conflict_check_freebusy_failed", {
      bookingId: booking.id,
      error: errorMessage(err),
    });
  }

  return null;
}

async function handlePostPaymentConflict(
  booking: Booking,
  meetingType: MeetingType,
  host: Host,
  detail: string
): Promise<void> {
  log.error("stripe-webhook", "post_payment_conflict", { bookingId: booking.id, detail });

  const failed = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: "FAILED_NEEDS_INTERVENTION",
      googleSyncError: `Slot conflict after payment: ${detail}`.slice(0, 1000),
      expiresAt: null,
    },
  });

  let refunded = false;
  if (failed.stripePaymentIntentId) {
    try {
      await stripe().refunds.create({
        payment_intent: failed.stripePaymentIntentId,
        reason: "duplicate",
        metadata: { bookingId: failed.id, reason: "slot_conflict" },
      });
      refunded = true;
      await prisma.booking.update({
        where: { id: failed.id },
        data: { stripePaymentStatus: "refunded" },
      });
    } catch (err) {
      log.error("stripe-webhook", "auto_refund_failed", {
        bookingId: failed.id,
        error: errorMessage(err),
      });
    }
  }

  await Promise.allSettled([
    sendConflictApology(failed, meetingType, host, refunded),
    sendConflictRefundAlert(failed, host, refunded, detail),
  ]);
}

/** Stripe `checkout.session.expired` — release the hold. */
export async function expireBookingBySession(sessionId: string): Promise<void> {
  const res = await prisma.booking.updateMany({
    where: {
      stripeSessionId: sessionId,
      status: "PENDING_PAYMENT",
      stripePaymentStatus: { not: "paid" },
    },
    data: { status: "EXPIRED", expiresAt: null },
  });
  if (res.count) log.info("stripe-webhook", "hold_released", { sessionId });
}

export type CancelResult = {
  booking: Booking;
  meetingType: MeetingType;
  calendarRemoved: boolean;
};

export async function cancelBooking(
  booking: Booking & { meetingType: MeetingType; host: Host },
  by: "booker" | "host"
): Promise<CancelResult> {
  let calendarRemoved = true;

  if (booking.googleEventId) {
    try {
      await deleteEvent(booking.host, booking.googleEventId);
    } catch (err) {
      calendarRemoved = false;
      log.error("booking", "calendar_delete_failed", {
        bookingId: booking.id,
        error: errorMessage(err),
      });
    }
  }

  const cancelled = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      expiresAt: null,
      ...(calendarRemoved ? {} : { googleSyncError: "Calendar event could not be deleted" }),
    },
  });

  log.info("booking", "cancelled", { bookingId: cancelled.id, by, calendarRemoved });

  await sendCancellationEmails(cancelled, booking.meetingType, booking.host, by).catch((err) =>
    log.warn("booking", "cancel_email_failed", { error: errorMessage(err) })
  );

  return { booking: cancelled, meetingType: booking.meetingType, calendarRemoved };
}

/** Admin retry for a FAILED_NEEDS_INTERVENTION booking. */
export async function retryFailedBooking(bookingId: string): Promise<Booking> {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { meetingType: true, host: true },
  });
  if (booking.status !== "FAILED_NEEDS_INTERVENTION") {
    throw new Error("Only failed bookings can be retried.");
  }
  const { meetingType, host, ...plain } = booking;
  return confirmWithCalendar(plain as Booking, meetingType, host);
}
