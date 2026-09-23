/**
 * The booking engine.
 *
 * Invariants (each has a test in tests/integration):
 *  1. A slot is claimed only inside `withHostLock`: a Postgres advisory lock held
 *     across the live calendar re-check, inside a Serializable transaction.
 *  2. The booking row commits before any side effect. Calendar writes, emails,
 *     webhooks, reminders and refunds run through the outbox (lib/jobs.ts) and are
 *     retried until they succeed or raise an alert.
 *  3. A CONFIRMED booking always owns its slot. If its calendar event could not be
 *     written yet, a calendar.create job is queued and the host is alerted.
 *  4. Stripe events are only acted on for objects this install created, and only
 *     once (conditional claim on webhookProcessedAt).
 */
import { randomBytes } from "node:crypto";
import { Prisma, type Booking, type Host, type MeetingType, type SingleUseLink } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "./db";
import { appUrl, isDemoMode } from "./env";
import {
  isSlotOnGrid,
  liveBookingStatusFilter,
  meetingTypeInclude,
  pausedMessage,
  scheduleTimezone,
  typeCounts,
  type MeetingTypeFull,
} from "./availability";
import { weekKey } from "./slots";
import { calendar } from "./calendar";
import { GoogleApiError, GoogleAuthError } from "./calendar-types";
import { errorMessage, log } from "./logger";
import { formatPrice, stripe } from "./stripe";
import { audit } from "./audit";
import { drainJobs, enqueue } from "./jobs";
import { queueWebhooks } from "./webhooks";
import { formatWhen, manageUrl, whereForCalendar, type BookingCtx } from "./emails";
import { sendCalendarPendingAlert, sendConflictRefundAlert } from "./alerts";
import { durationChoices, locationLabel, parseLocations, type LocationOption } from "./types";
import { bumpMetric } from "./analytics";

/**
 * "Not paid" including NULL. Prisma's `{ not: "paid" }` compiles to `<> 'paid'`,
 * which is false for NULL — a hold that died before its payment started would
 * never be swept and would burn its slot forever.
 */
const UNPAID = [{ stripePaymentStatus: null }, { stripePaymentStatus: { not: "paid" } }];

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

/** Booking is impossible right now (calendar unreadable, host paused). Fail closed. */
export class BookingUnavailableError extends Error {
  code: string;
  constructor(message = "Booking is temporarily unavailable. Please try again shortly.", code = "UNAVAILABLE") {
    super(message);
    this.name = "BookingUnavailableError";
    this.code = code;
  }
}

/** Invitee tried to change a booking inside the cutoff, or one that can't change. */
export class ChangeNotAllowedError extends Error {
  code = "NOT_ALLOWED";
  constructor(message: string) {
    super(message);
    this.name = "ChangeNotAllowedError";
  }
}

/** Free bookings hold the slot only for as long as the calendar call needs. */
const FREE_HOLD_MINUTES = 5;
/** Our DB hold must outlive the Stripe session so payment can never land on a released slot. */
export const PAID_HOLD_MINUTES = 33;
const STRIPE_SESSION_MINUTES = 31; // Stripe requires >= 30
/** How long a request waits for its own side effects before leaving them to the cron. */
const INLINE_DRAIN_MS = 6_000;

export async function getHost(): Promise<Host | null> {
  return prisma.host.findFirst({ orderBy: { createdAt: "asc" } });
}

export async function requireHost(): Promise<Host> {
  const host = await getHost();
  if (!host) throw new BookingUnavailableError("This BookKit instance is not set up yet.");
  return host;
}

/** True when bookings cannot currently be taken (calendar not connected / revoked). */
export function hostBookingBlocked(host: Host): boolean {
  return !host.googleRefreshToken || Boolean(host.googleAuthError);
}

export function newManageToken(): string {
  return randomBytes(24).toString("base64url");
}

type TxClient = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Runs fn inside a Serializable transaction that first takes a Postgres advisory lock
 * keyed on the host. The lock is what actually serializes competing bookers: it holds
 * across the calendar freebusy round-trip, which no isolation level can do on its own.
 */
async function withHostLock<T>(hostId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // ::text cast because Prisma cannot deserialize the bare void return.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${hostId}))::text`;
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

/**
 * Retire this host's expired unpaid holds, inside the lock. Reads already treat an
 * expired hold as free, but the partial unique index counts every PENDING_PAYMENT
 * row; without this sweep a hold whose expiry webhook never arrived would burn its
 * slot forever.
 */
async function sweepExpiredHoldsInTx(tx: TxClient, hostId: string, now: Date): Promise<void> {
  await tx.booking.updateMany({
    where: {
      hostId,
      status: "PENDING_PAYMENT",
      expiresAt: { lte: now },
      OR: UNPAID,
    },
    data: { status: "EXPIRED", expiresAt: null },
  });
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
      OR: liveBookingStatusFilter(now),
    },
  });
}

async function limitReachedInTx(
  tx: TxClient,
  mt: MeetingTypeFull,
  host: Host,
  startTime: Date,
  now: Date,
  excludeBookingId?: string
): Promise<string | null> {
  if (!mt.dailyLimit && !mt.weeklyLimit) return null;
  const tz = scheduleTimezone(mt, host);
  const { dayCounts, weekCounts } = await typeCounts(
    mt.id,
    tz,
    startTime,
    startTime,
    now,
    excludeBookingId,
    tx
  );
  const local = DateTime.fromJSDate(startTime, { zone: tz });
  if (mt.dailyLimit && (dayCounts.get(local.toFormat("yyyy-MM-dd")) ?? 0) >= mt.dailyLimit) {
    return "No more bookings are available that day.";
  }
  if (mt.weeklyLimit && (weekCounts.get(weekKey(local)) ?? 0) >= mt.weeklyLimit) {
    return "No more bookings are available that week.";
  }
  return null;
}

export type BookingInput = {
  name: string;
  email: string;
  timezone: string;
  /** Structured answers (already validated against the meeting type). */
  answers?: { id?: string; label: string; answer: string }[];
  /** Display string of the answers. */
  customAnswer?: string | null;
  startTime: Date;
  /** Chosen duration; must be one of the type's durations. Defaults to the type's. */
  durationMinutes?: number;
  guests?: string[];
  /** Chosen location (validated against the type's options). */
  location?: LocationOption | null;
  utm?: Record<string, string> | null;
  /** Token of a single-use link this booking consumes. */
  singleUseToken?: string | null;
};

/** Price for a booking of `durationMinutes`, honouring a single-use link override. */
export function priceFor(
  mt: MeetingType,
  durationMinutes: number,
  link?: Pick<SingleUseLink, "priceCents"> | null
): number | null {
  if (link && link.priceCents !== null && link.priceCents !== undefined) {
    return link.priceCents > 0 ? link.priceCents : null;
  }
  const choice = durationChoices(mt).find((d) => d.minutes === durationMinutes);
  const p = choice ? choice.priceCents : mt.priceCents;
  return p && p > 0 ? p : null;
}

/** Validate and resolve a single-use link for this meeting type. */
export async function resolveSingleUseLink(
  mt: MeetingType,
  token: string | null | undefined
): Promise<SingleUseLink | null> {
  if (!token) return null;
  let link = await prisma.singleUseLink.findUnique({ where: { token } });
  if (!link || link.meetingTypeId !== mt.id) throw new InvalidSlotError("This booking link is not valid.");
  // A hold that expired unpaid (Stripe expiry, cron or in-lock sweep) gives the link back.
  // One statement, so a late payment that claims the booking first keeps the link.
  // ponytail: a payment landing AFTER the release still confirms (the payer paid), so that
  // link can end up behind two bookings. Rare (hold long expired); re-claim in settle if it bites.
  if (link.usedAt && link.bookingId) {
    const released = await prisma.$executeRaw`
      UPDATE "SingleUseLink" SET "usedAt" = NULL, "bookingId" = NULL
      WHERE id = ${link.id} AND "bookingId" = ${link.bookingId}
        AND NOT EXISTS (
          SELECT 1 FROM "Booking" b WHERE b.id = ${link.bookingId}
            AND (b.status <> 'EXPIRED' OR b."stripePaymentStatus" = 'paid')
        )`;
    if (released) link = { ...link, usedAt: null, bookingId: null };
  }
  if (link.usedAt) throw new InvalidSlotError("This one-time booking link has already been used.");
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    throw new InvalidSlotError("This one-time booking link has expired.");
  }
  return link;
}

export function resolveDuration(mt: MeetingType, requested: number | undefined, link?: SingleUseLink | null) {
  if (link?.durationMinutes) return link.durationMinutes;
  if (requested === undefined) return mt.durationMinutes;
  if (!durationChoices(mt).some((d) => d.minutes === requested)) {
    throw new InvalidSlotError("That duration is not offered for this meeting type.");
  }
  return requested;
}

function resolveLocation(mt: MeetingType, chosen: LocationOption | null | undefined): LocationOption {
  const options = parseLocations(mt.locations);
  if (!chosen) return options[0];
  const match = options.find((o) => o.kind === chosen.kind && (o.value ?? null) === (chosen.value ?? null));
  if (match) return match;
  // phone_invitee carries the invitee's number, which the options don't know.
  const phone = options.find((o) => o.kind === "phone_invitee");
  if (chosen.kind === "phone_invitee" && phone) {
    return { kind: "phone_invitee", value: chosen.value ?? null, label: phone.label ?? null };
  }
  throw new InvalidSlotError("That meeting location is not offered.");
}

/**
 * Atomically claim a slot. Validates grid legality, DB overlaps (including live
 * holds), limits and live calendar freebusy, then inserts — all under the host lock.
 */
async function reserveSlot(
  host: Host,
  mt: MeetingTypeFull,
  input: BookingInput,
  opts: { holdMinutes: number; paid: boolean }
): Promise<Booking> {
  const now = new Date();
  if (pausedMessage(host, now)) throw new BookingUnavailableError(pausedMessage(host, now)!, "PAUSED");
  if (hostBookingBlocked(host)) {
    throw new BookingUnavailableError("Online booking is temporarily unavailable. Please email to arrange a time.", "CALENDAR_DISCONNECTED");
  }

  const link = await resolveSingleUseLink(mt, input.singleUseToken);
  const duration = resolveDuration(mt, input.durationMinutes, link);
  const location = resolveLocation(mt, input.location);
  const amountCents = priceFor(mt, duration, link);
  if (opts.paid !== Boolean(amountCents)) {
    throw new InvalidSlotError(amountCents ? "This meeting requires payment." : "This meeting is free.");
  }

  const startTime = input.startTime;
  const endTime = new Date(startTime.getTime() + duration * 60_000);
  if (!isSlotOnGrid(mt, host, startTime, now, duration)) throw new InvalidSlotError();

  const guardStart = new Date(startTime.getTime() - mt.bufferBeforeMinutes * 60_000);
  const guardEnd = new Date(endTime.getTime() + mt.bufferAfterMinutes * 60_000);
  const guests = mt.allowGuests ? (input.guests ?? []).slice(0, mt.maxGuests) : [];

  try {
    return await withHostLock(host.id, async (tx) => {
      await sweepExpiredHoldsInTx(tx, host.id, now);

      if (await overlapsInTx(tx, host.id, guardStart, guardEnd, now)) throw new SlotTakenError();

      const limit = await limitReachedInTx(tx, mt, host, startTime, now);
      if (limit) throw new SlotTakenError(limit);

      // Live re-check against the real calendar, inside the lock: catches events the
      // host added by hand since the page was rendered.
      const busy = await calendar().freeBusy(host, guardStart, guardEnd);
      if (busy.some((b) => b.start.getTime() < guardEnd.getTime() && b.end.getTime() > guardStart.getTime())) {
        throw new SlotTakenError();
      }

      if (link) {
        const claimed = await tx.singleUseLink.updateMany({
          where: { id: link.id, usedAt: null },
          data: { usedAt: now },
        });
        if (!claimed.count) throw new InvalidSlotError("This one-time booking link has already been used.");
      }

      const booking = await tx.booking.create({
        data: {
          hostId: host.id,
          meetingTypeId: mt.id,
          name: input.name,
          email: input.email,
          timezone: input.timezone,
          customAnswer: input.customAnswer ?? null,
          answers: input.answers?.length ? input.answers : undefined,
          guests,
          location: location as Prisma.InputJsonValue,
          utm: input.utm && Object.keys(input.utm).length ? input.utm : undefined,
          singleUseLinkId: link?.id ?? null,
          startTime,
          endTime,
          status: "PENDING_PAYMENT",
          amountCents,
          expiresAt: new Date(now.getTime() + opts.holdMinutes * 60_000),
          cancelToken: newManageToken(),
        },
      });
      if (link) await tx.singleUseLink.update({ where: { id: link.id }, data: { bookingId: booking.id } });
      await audit(booking.id, "reserved", { startTime: startTime.toISOString(), duration, paid: opts.paid }, tx);
      return booking;
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

export async function loadCtx(bookingId: string): Promise<BookingCtx & { meetingType: MeetingTypeFull }> {
  const row = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { meetingType: { include: meetingTypeInclude }, host: true },
  });
  const { meetingType, host, ...booking } = row;
  return { booking: booking as Booking, meetingType, host };
}

function eventDescription(ctx: BookingCtx): string {
  const { booking, meetingType } = ctx;
  const loc = booking.location as LocationOption | null;
  const lines = [`Booked via BookKit: ${meetingType.name}`, "", `Name: ${booking.name}`, `Email: ${booking.email}`];
  if (booking.guests.length) lines.push(`Guests: ${booking.guests.join(", ")}`);
  lines.push(`Their timezone: ${booking.timezone}`);
  if (loc && loc.kind !== "google_meet") lines.push(`Location: ${locationLabel(loc)}${loc.value ? ` — ${loc.value}` : ""}`);
  if (booking.customAnswer) lines.push("", booking.customAnswer);
  if (booking.amountCents && booking.stripePaymentStatus === "paid") {
    lines.push("", `Paid: ${formatPrice(booking.amountCents, meetingType.currency)}`);
  }
  const utm = booking.utm as Record<string, string> | null;
  if (utm) lines.push("", `Source: ${Object.entries(utm).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  lines.push("", `Reschedule or cancel: ${manageUrl(booking)}`);
  return lines.join("\n");
}

/** Write the booking's calendar event. Used inline on booking and by the calendar.create job. */
export async function writeCalendarEvent(bookingId: string): Promise<Booking> {
  const ctx = await loadCtx(bookingId);
  const { booking, meetingType, host } = ctx;
  if (booking.googleEventId) return booking;
  const loc = booking.location as LocationOption | null;
  const event = await calendar().createEventWithRetry(host, {
    bookingId: booking.id,
    summary: `${meetingType.name} — ${booking.name}`,
    description: eventDescription(ctx),
    startTime: booking.startTime,
    endTime: booking.endTime,
    attendeeEmail: booking.email,
    attendeeName: booking.name,
    guestEmails: booking.guests,
    location: loc && loc.kind !== "google_meet" ? whereForCalendar(booking) : null,
    createMeet: !loc || loc.kind === "google_meet",
  });
  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      googleEventId: event.eventId,
      googleEventAt: new Date(),
      meetLink: event.meetLink,
      googleSyncError: null,
    },
  });
  await audit(booking.id, "calendar_written", { eventId: event.eventId });
  const { resolveAlert } = await import("./alerts");
  await resolveAlert(`calendar_pending:${booking.id}`);
  return updated;
}

/**
 * Promote a held booking to CONFIRMED. The calendar event is attempted inline;
 * if it fails the booking is still confirmed (the slot is ours in the DB), a
 * calendar.create job keeps retrying and the host is alerted.
 */
async function confirmBooking(bookingId: string): Promise<Booking> {
  let booking = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "CONFIRMED", expiresAt: null },
  });
  await audit(bookingId, "confirmed");

  try {
    booking = await writeCalendarEvent(bookingId);
  } catch (err) {
    const reason = errorMessage(err);
    booking = await prisma.booking.update({
      where: { id: bookingId },
      data: { googleSyncError: reason.slice(0, 1000), retryCount: { increment: 1 }, lastRetryAt: new Date() },
    });
    log.error("booking", "calendar_pending", { bookingId, error: reason });
    await audit(bookingId, "calendar_failed", { error: reason.slice(0, 300) });
    await enqueue("calendar.create", {}, { bookingId, dedupeKey: `calendar.create:${bookingId}`, runAt: new Date(Date.now() + 30_000), maxAttempts: 20 });
    const host = await prisma.host.findUnique({ where: { id: booking.hostId } });
    await sendCalendarPendingAlert(booking, host, reason);
  }

  await queueConfirmationEffects(bookingId);
  return booking;
}

/** Emails, webhooks, reminders, follow-up and analytics for a freshly confirmed booking. */
async function queueConfirmationEffects(bookingId: string): Promise<void> {
  const ctx = await loadCtx(bookingId);
  const { booking, meetingType } = ctx;
  await enqueue("email", { template: "confirmation" }, { bookingId, dedupeKey: `email:confirmation:${bookingId}` });
  await enqueue("email", { template: "host_new" }, { bookingId, dedupeKey: `email:host_new:${bookingId}` });
  await queueWebhooks("booking.created", booking, meetingType);
  if (booking.stripePaymentStatus === "paid") await queueWebhooks("booking.paid", booking, meetingType);
  await queueReminders(booking, meetingType);
  await bumpMetric(meetingType.id, "booked", (booking.utm as Record<string, string> | null)?.utm_source ?? "");
}

/** Reminder + follow-up jobs for the booking's current start time. Old ones skip themselves. */
async function queueReminders(booking: Booking, mt: MeetingType): Promise<void> {
  const now = Date.now();
  const start = booking.startTime.getTime();
  for (const minutes of mt.reminderMinutes ?? []) {
    const runAt = start - minutes * 60_000;
    // Skip reminders that would fire within 10 minutes of booking — they add nothing.
    if (runAt < now + 10 * 60_000) continue;
    await enqueue(
      "reminder",
      { minutes, startTime: booking.startTime.toISOString(), rev: booking.rescheduleCount },
      { bookingId: booking.id, runAt: new Date(runAt), dedupeKey: `reminder:${booking.id}:${start}:${minutes}:r${booking.rescheduleCount}` }
    );
  }
  if (mt.followUpMinutes) {
    await enqueue(
      "followup",
      { startTime: booking.startTime.toISOString(), rev: booking.rescheduleCount },
      {
        bookingId: booking.id,
        runAt: new Date(booking.endTime.getTime() + mt.followUpMinutes * 60_000),
        dedupeKey: `followup:${booking.id}:${start}:r${booking.rescheduleCount}`,
      }
    );
  }
}

async function drainFor(bookingId: string) {
  await drainJobs({ bookingId, budgetMs: INLINE_DRAIN_MS }).catch((err) =>
    log.warn("booking", "inline_drain_failed", { bookingId, error: errorMessage(err) })
  );
}

/** Free meeting type: reserve, confirm, run side effects. */
export async function createFreeBooking(
  host: Host,
  mt: MeetingTypeFull,
  input: BookingInput
): Promise<Booking> {
  const held = await reserveSlot(host, mt, input, { holdMinutes: FREE_HOLD_MINUTES, paid: false });
  const booking = await confirmBooking(held.id);
  await drainFor(booking.id);
  return prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
}

function assertPaymentsAllowed() {
  // The demo instance must never touch a real card.
  if (isDemoMode()) throw new BookingUnavailableError("Paid bookings are disabled on the demo instance.");
}

/** Paid meeting type, hosted Stripe Checkout: reserve a hold, return the checkout URL. */
export async function startPaidCheckout(
  host: Host,
  mt: MeetingTypeFull,
  input: BookingInput
): Promise<{ booking: Booking; checkoutUrl: string }> {
  assertPaymentsAllowed();
  const booking = await reserveSlot(host, mt, input, { holdMinutes: PAID_HOLD_MINUTES, paid: true });
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      customer_email: booking.email,
      client_reference_id: booking.id,
      expires_at: Math.floor(Date.now() / 1000) + STRIPE_SESSION_MINUTES * 60,
      allow_promotion_codes: true,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: mt.currency,
            unit_amount: booking.amountCents!,
            product_data: { name: mt.name, description: formatWhen(booking.startTime, booking.timezone) },
          },
        },
      ],
      metadata: { bookkit: "1", bookingId: booking.id, meetingTypeSlug: mt.slug },
      payment_intent_data: { metadata: { bookkit: "1", bookingId: booking.id } },
      success_url: `${appUrl()}/success?booking=${booking.id}&t=${booking.cancelToken}`,
      cancel_url: `${appUrl()}/${mt.slug}?cancelled=1`,
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { stripeSessionId: session.id, stripePaymentStatus: "unpaid" },
    });
    await audit(booking.id, "checkout_started", { sessionId: session.id });
    return { booking: updated, checkoutUrl: session.url };
  } catch (err) {
    await releaseHold(booking.id, "checkout_failed", err);
    throw err;
  }
}

/**
 * Embedded-payment flow: reserve the hold, then hand back a PaymentIntent client
 * secret so the card fields render inline on the booking page (no redirect).
 */
export async function startPaidIntent(
  host: Host,
  mt: MeetingTypeFull,
  input: BookingInput
): Promise<{ booking: Booking; clientSecret: string; expiresAt: string }> {
  assertPaymentsAllowed();
  const booking = await reserveSlot(host, mt, input, { holdMinutes: PAID_HOLD_MINUTES, paid: true });
  try {
    const intent = await stripe().paymentIntents.create(
      {
        amount: booking.amountCents!,
        currency: mt.currency,
        receipt_email: booking.email,
        automatic_payment_methods: { enabled: true },
        description: `${mt.name} — ${formatWhen(booking.startTime, booking.timezone)}`,
        metadata: { bookkit: "1", bookingId: booking.id, meetingTypeSlug: mt.slug },
      },
      { idempotencyKey: `bookkit-intent-${booking.id}` }
    );
    if (!intent.client_secret) throw new Error("Stripe returned no client secret");
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { stripePaymentIntentId: intent.id, stripePaymentStatus: "unpaid" },
    });
    await audit(booking.id, "payment_started", { intentId: intent.id });
    return { booking: updated, clientSecret: intent.client_secret, expiresAt: booking.expiresAt!.toISOString() };
  } catch (err) {
    await releaseHold(booking.id, "payment_start_failed", err);
    throw err;
  }
}

async function releaseHold(bookingId: string, why: string, err: unknown) {
  await prisma.booking
    .update({ where: { id: bookingId }, data: { status: "EXPIRED", expiresAt: null } })
    .catch(() => undefined);
  // A single-use link consumed by a hold that never paid goes back to usable.
  await prisma.singleUseLink
    .updateMany({ where: { bookingId }, data: { usedAt: null, bookingId: null } })
    .catch(() => undefined);
  log.error("booking", why, { bookingId, error: errorMessage(err) });
  await audit(bookingId, why, { error: errorMessage(err).slice(0, 300) });
}

/** Shared settlement once a payment has been atomically claimed. */
async function settleClaimedBooking(bookingId: string): Promise<void> {
  const ctx = await loadCtx(bookingId);
  const { booking } = ctx;
  await audit(bookingId, "paid", { amountCents: booking.amountCents });
  if (booking.status === "CONFIRMED") return;

  const conflict = await findPostPaymentConflict(ctx);
  if (conflict) {
    await handlePostPaymentConflict(ctx, conflict);
    return;
  }
  await confirmBooking(bookingId);
  await drainFor(bookingId);
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
  const existing = await prisma.booking.findUnique({ where: { stripeSessionId: session.id } });
  if (!existing) {
    log.info("stripe-webhook", "unknown_session_ignored", { sessionId: session.id });
    return;
  }
  if (session.payment_status && session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    log.info("stripe-webhook", "session_not_paid", { sessionId: session.id, status: session.payment_status });
    return;
  }
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
    log.info("stripe-webhook", "duplicate_ignored", { sessionId: session.id, bookingId: existing.id });
    return;
  }
  await settleClaimedBooking(existing.id);
}

/** Stripe `payment_intent.succeeded` for the embedded flow. Same idempotent claim. */
export async function finalizePaidIntent(intent: { id: string; amount_received: number | null }): Promise<void> {
  const existing = await prisma.booking.findFirst({
    where: { stripePaymentIntentId: intent.id },
    select: { id: true, amountCents: true },
  });
  if (!existing) {
    // Not one of ours — a shared Stripe account fires everything at everyone.
    log.info("stripe-webhook", "unknown_intent_ignored", { intentId: intent.id });
    return;
  }
  const claimed = await prisma.booking.updateMany({
    where: { id: existing.id, webhookProcessedAt: null },
    data: {
      webhookProcessedAt: new Date(),
      stripePaymentStatus: "paid",
      stripePaidAt: new Date(),
      amountCents: intent.amount_received || existing.amountCents,
    },
  });
  if (claimed.count === 0) {
    log.info("stripe-webhook", "duplicate_ignored", { intentId: intent.id, bookingId: existing.id });
    return;
  }
  await settleClaimedBooking(existing.id);
}

/**
 * Pull-based payment check, so a delayed or lost webhook never strands a payer.
 * Called by the booking page while it waits and by the cron sweep.
 */
export async function syncPaymentFromStripe(bookingId: string): Promise<void> {
  const b = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!b || b.webhookProcessedAt || b.stripePaymentStatus === "paid") return;
  if (b.stripePaymentIntentId) {
    const intent = await stripe().paymentIntents.retrieve(b.stripePaymentIntentId);
    if (intent.status === "succeeded") {
      log.info("booking", "payment_synced_by_pull", { bookingId });
      await finalizePaidIntent({ id: intent.id, amount_received: intent.amount_received });
    }
  } else if (b.stripeSessionId) {
    const session = await stripe().checkout.sessions.retrieve(b.stripeSessionId);
    if (session.payment_status === "paid") {
      log.info("booking", "payment_synced_by_pull", { bookingId });
      await finalizePaidBooking({
        id: session.id,
        payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
        payment_status: session.payment_status,
        amount_total: session.amount_total,
      });
    }
  }
}

/**
 * Conflict detection at settlement. Overlap-only: min-notice may have elapsed during
 * checkout and that must never cause a refund. A freebusy error is never treated as
 * a conflict — we only refund on positive evidence.
 */
async function findPostPaymentConflict(ctx: BookingCtx): Promise<string | null> {
  const { booking, meetingType, host } = ctx;
  const now = new Date();
  const guardStart = new Date(booking.startTime.getTime() - meetingType.bufferBeforeMinutes * 60_000);
  const guardEnd = new Date(booking.endTime.getTime() + meetingType.bufferAfterMinutes * 60_000);

  const dbClash = await prisma.booking.findFirst({
    where: {
      hostId: booking.hostId,
      id: { not: booking.id },
      startTime: { lt: guardEnd },
      endTime: { gt: guardStart },
      OR: liveBookingStatusFilter(now),
    },
    select: { id: true },
  });
  if (dbClash) return `overlapping booking ${dbClash.id}`;

  try {
    const busy = await calendar().freeBusy(host, guardStart, guardEnd);
    const clash = busy.find((b) => b.start.getTime() < guardEnd.getTime() && b.end.getTime() > guardStart.getTime());
    if (clash) return `calendar busy ${clash.start.toISOString()}–${clash.end.toISOString()}`;
  } catch (err) {
    log.warn("stripe-webhook", "conflict_check_freebusy_failed", { bookingId: booking.id, error: errorMessage(err) });
  }
  return null;
}

async function handlePostPaymentConflict(ctx: BookingCtx, detail: string): Promise<void> {
  const { booking, host } = ctx;
  log.error("stripe-webhook", "post_payment_conflict", { bookingId: booking.id, detail });
  const failed = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: "FAILED_NEEDS_INTERVENTION",
      googleSyncError: `Slot conflict after payment: ${detail}`.slice(0, 1000),
      expiresAt: null,
    },
  });
  await audit(booking.id, "paid_conflict", { detail });

  const refunded = await refundNow(failed.id, "slot_conflict");
  const fresh = { ...ctx, booking: await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }) };
  await enqueue("email", { template: "conflict_apology", refunded }, { bookingId: booking.id, dedupeKey: `email:conflict:${booking.id}` });
  await sendConflictRefundAlert(fresh.booking, host, refunded, detail);
  await drainFor(booking.id);
}

/** Stripe `checkout.session.expired` — release the hold. */
export async function expireBookingBySession(sessionId: string): Promise<void> {
  const res = await prisma.booking.updateMany({
    where: { stripeSessionId: sessionId, status: "PENDING_PAYMENT", OR: UNPAID },
    data: { status: "EXPIRED", expiresAt: null },
  });
  if (res.count) log.info("stripe-webhook", "hold_released", { sessionId });
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

/**
 * Full refund of a booking's payment. Idempotent on our side (status check) and on
 * Stripe's (idempotency key). Returns true when the booking is refunded.
 */
export async function refundBooking(bookingId: string, reason: string): Promise<boolean> {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  if (b.stripePaymentStatus === "refunded") return true;
  if (b.stripePaymentStatus !== "paid" || !b.stripePaymentIntentId) return false;
  await stripe().refunds.create(
    {
      payment_intent: b.stripePaymentIntentId,
      reason: reason === "slot_conflict" ? "duplicate" : "requested_by_customer",
      metadata: { bookkit: "1", bookingId, reason },
    },
    { idempotencyKey: `bookkit-refund-${bookingId}` }
  );
  await prisma.booking.update({ where: { id: bookingId }, data: { stripePaymentStatus: "refunded" } });
  await audit(bookingId, "refunded", { reason });
  return true;
}

/** Try the refund inline; on failure leave a retrying job and report false. */
async function refundNow(bookingId: string, reason: string): Promise<boolean> {
  try {
    return await refundBooking(bookingId, reason);
  } catch (err) {
    log.error("booking", "refund_failed_queued", { bookingId, error: errorMessage(err) });
    await enqueue("refund", { reason }, { bookingId, dedupeKey: `refund:${bookingId}`, maxAttempts: 12 });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Invitee self-service rules
// ---------------------------------------------------------------------------

export type ChangePolicy = { allowed: boolean; reason?: string; refundOnCancel: boolean };

/** What an invitee may do with a booking right now. Hosts are never restricted. */
export function inviteePolicy(booking: Booking, mt: MeetingType, now = new Date()): ChangePolicy {
  if (booking.status !== "CONFIRMED") {
    return { allowed: false, reason: "This booking can no longer be changed.", refundOnCancel: false };
  }
  if (booking.startTime.getTime() <= now.getTime()) {
    return { allowed: false, reason: "This meeting has already started.", refundOnCancel: false };
  }
  const cutoffMs = (mt.cancelCutoffHours ?? 0) * 3_600_000;
  const insideCutoff = cutoffMs > 0 && booking.startTime.getTime() - now.getTime() < cutoffMs;
  const paid = booking.stripePaymentStatus === "paid";
  const refundOnCancel =
    paid && (mt.refundPolicy === "always" || (mt.refundPolicy === "before_cutoff" && !insideCutoff));
  if (insideCutoff) {
    return {
      allowed: false,
      reason: `Changes are only possible up to ${mt.cancelCutoffHours} hour${mt.cancelCutoffHours === 1 ? "" : "s"} before the meeting. Reply to your confirmation email to reach the host.`,
      refundOnCancel,
    };
  }
  return { allowed: true, refundOnCancel };
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export type CancelOptions = {
  reason?: string | null;
  /** Host only: send the invitee a cancellation email. Default true. */
  notify?: boolean;
  /** Host only: refund regardless of policy. Default: always for host cancels. */
  refund?: boolean;
};

export async function cancelBooking(
  bookingId: string,
  by: "invitee" | "host" | "system",
  opts: CancelOptions = {}
): Promise<{ booking: Booking; refunded: boolean; calendarRemoved: boolean }> {
  const ctx = await loadCtx(bookingId);
  const { booking, meetingType, host } = ctx;

  if (booking.status === "CANCELLED") return { booking, refunded: booking.stripePaymentStatus === "refunded", calendarRemoved: true };

  let refund = false;
  if (by === "invitee") {
    const policy = inviteePolicy(booking, meetingType);
    if (!policy.allowed) throw new ChangeNotAllowedError(policy.reason!);
    refund = policy.refundOnCancel;
  } else {
    refund = booking.stripePaymentStatus === "paid" && opts.refund !== false;
  }

  const cancelled = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledBy: by,
      cancelReason: opts.reason?.trim().slice(0, 1000) || null,
      expiresAt: null,
    },
  });
  await audit(booking.id, "cancelled", { by, reason: cancelled.cancelReason, refund });
  log.info("booking", "cancelled", { bookingId: booking.id, by });

  let calendarRemoved = true;
  if (booking.googleEventId) {
    try {
      await calendar().deleteEvent(host, booking.googleEventId);
      await audit(booking.id, "calendar_deleted");
    } catch (err) {
      calendarRemoved = false;
      await prisma.booking.update({
        where: { id: booking.id },
        data: { googleSyncError: "Calendar event could not be deleted yet (retrying automatically)" },
      });
      await enqueue("calendar.delete", { eventId: booking.googleEventId }, { bookingId: booking.id, dedupeKey: `calendar.delete:${booking.id}:${booking.googleEventId}` });
      log.error("booking", "calendar_delete_failed_queued", { bookingId: booking.id, error: errorMessage(err) });
    }
  }

  const refunded = refund ? await refundNow(booking.id, "cancelled") : false;

  if (opts.notify !== false || by !== "host") {
    await enqueue("email", { template: "cancelled_invitee" }, { bookingId: booking.id, dedupeKey: `email:cancelled_invitee:${booking.id}` });
  }
  if (by !== "host") {
    await enqueue("email", { template: "cancelled_host" }, { bookingId: booking.id, dedupeKey: `email:cancelled_host:${booking.id}` });
  }
  const final = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
  await queueWebhooks("booking.cancelled", final, meetingType);
  await bumpMetric(meetingType.id, "cancelled", "");
  await drainFor(booking.id);
  return { booking: final, refunded, calendarRemoved };
}

// ---------------------------------------------------------------------------
// Reschedule
// ---------------------------------------------------------------------------

/**
 * Move a confirmed booking to a new start time. Same rules as a new booking (grid,
 * notice, window, limits, overlap, live calendar), except the booking never blocks
 * itself. Payment, answers, guests and the calendar event carry over.
 */
export async function rescheduleBooking(
  bookingId: string,
  newStart: Date,
  by: "invitee" | "host",
  opts: { reason?: string | null } = {}
): Promise<Booking> {
  const ctx = await loadCtx(bookingId);
  const { booking, meetingType: mt, host } = ctx;
  const now = new Date();

  if (by === "invitee") {
    const policy = inviteePolicy(booking, mt, now);
    if (!policy.allowed) throw new ChangeNotAllowedError(policy.reason!);
  } else if (booking.status !== "CONFIRMED") {
    throw new ChangeNotAllowedError("Only confirmed bookings can be rescheduled.");
  }
  if (newStart.getTime() === booking.startTime.getTime()) return booking;

  const duration = Math.round((booking.endTime.getTime() - booking.startTime.getTime()) / 60_000);
  const newEnd = new Date(newStart.getTime() + duration * 60_000);
  // Hosts may move a booking anywhere free; invitees are held to the published grid.
  if (by === "invitee" && !isSlotOnGrid(mt, host, newStart, now, duration)) throw new InvalidSlotError();
  if (newStart.getTime() <= now.getTime()) throw new InvalidSlotError("Pick a time in the future.");

  const guardStart = new Date(newStart.getTime() - mt.bufferBeforeMinutes * 60_000);
  const guardEnd = new Date(newEnd.getTime() + mt.bufferAfterMinutes * 60_000);

  let updated: Booking;
  try {
    updated = await withHostLock(host.id, async (tx) => {
      await sweepExpiredHoldsInTx(tx, host.id, now);
      const fresh = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
      if (fresh.status !== "CONFIRMED" || fresh.startTime.getTime() !== booking.startTime.getTime()) {
        throw new ChangeNotAllowedError("This booking changed in the meantime. Reload and try again.");
      }
      if (await overlapsInTx(tx, host.id, guardStart, guardEnd, now, booking.id)) throw new SlotTakenError();
      const limit = await limitReachedInTx(tx, mt, host, newStart, now, booking.id);
      if (limit && by === "invitee") throw new SlotTakenError(limit);

      // A booking never blocks its own move: drop exactly its calendar event (by id, not
      // by time range, which would also hide other events inside the old slot). No event
      // id = the event was never written, so nothing of ours is on the calendar.
      const busy = await calendar().freeBusy(host, guardStart, guardEnd, fresh.googleEventId ?? undefined);
      if (busy.some((b) => b.start.getTime() < guardEnd.getTime() && b.end.getTime() > guardStart.getTime())) {
        throw new SlotTakenError();
      }
      const row = await tx.booking.update({
        where: { id: booking.id },
        data: {
          startTime: newStart,
          endTime: newEnd,
          previousStartTime: booking.startTime,
          rescheduleCount: { increment: 1 },
          // Reuse the reason field for the reschedule note; cancelledBy stays null.
          cancelReason: opts.reason?.trim().slice(0, 1000) || null,
        },
      });
      await audit(booking.id, "rescheduled", { by, from: booking.startTime.toISOString(), to: newStart.toISOString() }, tx);
      return row;
    });
  } catch (err) {
    if (err instanceof GoogleAuthError || err instanceof GoogleApiError) throw new BookingUnavailableError();
    if ((err as { code?: string })?.code === "P2002") throw new SlotTakenError();
    throw err;
  }

  if (updated.googleEventId) {
    try {
      await calendar().updateEvent(host, updated.googleEventId, { startTime: newStart, endTime: newEnd });
      await audit(booking.id, "calendar_updated");
    } catch (err) {
      await enqueue("calendar.update", {}, { bookingId: booking.id, dedupeKey: `calendar.update:${booking.id}:${newStart.getTime()}:r${updated.rescheduleCount}`, maxAttempts: 20 });
      await sendCalendarPendingAlert(updated, host, `reschedule not yet on calendar: ${errorMessage(err)}`);
    }
  } else {
    // The original write never landed; the pending calendar.create job reads the new time.
  }

  // Per-change key: A→B→A→B must notify on the second move to B too.
  const stamp = `${newStart.getTime()}:r${updated.rescheduleCount}`;
  await enqueue("email", { template: "rescheduled_invitee" }, { bookingId: booking.id, dedupeKey: `email:rescheduled_invitee:${booking.id}:${stamp}` });
  if (by === "invitee") {
    await enqueue("email", { template: "rescheduled_host" }, { bookingId: booking.id, dedupeKey: `email:rescheduled_host:${booking.id}:${stamp}` });
  }
  await queueReminders(updated, mt);
  await queueWebhooks("booking.rescheduled", updated, mt);
  await drainFor(booking.id);
  return prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
}

// ---------------------------------------------------------------------------
// Host tools
// ---------------------------------------------------------------------------

export async function markNoShow(bookingId: string, noShow: boolean): Promise<Booking> {
  const b = await prisma.booking.update({ where: { id: bookingId }, data: { noShow } });
  await audit(bookingId, noShow ? "no_show" : "no_show_undone");
  if (noShow) {
    const mt = await prisma.meetingType.findUniqueOrThrow({ where: { id: b.meetingTypeId } });
    await queueWebhooks("booking.no_show", b, mt);
    await bumpMetric(mt.id, "no_show", "");
  }
  return b;
}

/** Admin "retry": re-run the calendar write for a failed or pending booking now. */
export async function retryFailedBooking(bookingId: string): Promise<Booking> {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  if (b.status === "FAILED_NEEDS_INTERVENTION") {
    // Only a paid-then-conflicted booking lands here; the host decided to honour it.
    await prisma.booking.update({ where: { id: bookingId }, data: { status: "CONFIRMED", googleSyncError: null } });
    await audit(bookingId, "host_forced_confirm");
  }
  if (!b.googleEventId) {
    try {
      await writeCalendarEvent(bookingId);
    } catch (err) {
      await prisma.booking.update({
        where: { id: bookingId },
        data: { googleSyncError: errorMessage(err).slice(0, 1000), retryCount: { increment: 1 }, lastRetryAt: new Date() },
      });
      throw err;
    }
  }
  if (b.status === "FAILED_NEEDS_INTERVENTION") await queueConfirmationEffects(bookingId);
  await drainFor(bookingId);
  return prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
}

/** Find a booking by its manage token (the secret in every invitee link). */
export async function findByManageToken(token: string) {
  if (!token || token.length < 16 || token.length > 128) return null;
  return prisma.booking.findUnique({
    where: { cancelToken: token },
    include: { meetingType: { include: meetingTypeInclude }, host: true },
  });
}
