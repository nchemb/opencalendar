"use client";

import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BookingParams } from "@/lib/ui/params";
import { money } from "@/lib/ui/format";
import type { PublicMeetingType } from "@/lib/types";
import { emitEmbed, useEmbedResize, useParentUtm, type EmbedCtx } from "@/lib/ui/embed";
import type { InitialSlots } from "@/lib/ui/initial-slots";
import CalendarAndSlots from "./CalendarAndSlots";
import Confirmation, { type ConfirmedBooking } from "./Confirmation";
import DetailsForm, { type DetailsPayload, type FormState } from "./DetailsForm";
import EventDetails from "./EventDetails";
import PaymentStep from "./PaymentStep";

type Props = {
  meetingType: PublicMeetingType;
  hostEmail: string;
  blocked?: boolean;
  embed?: boolean;
  embedCtx?: EmbedCtx;
  hideDetails?: boolean;
  chrome?: boolean;
  stripePublishableKey?: string | null;
  params: BookingParams;
  initialSlots?: InitialSlots | null;
};

type Step = "calendar" | "details" | "payment" | "confirming" | "confirmed";

export default function BookingWidget({
  meetingType: mt,
  hostEmail,
  blocked = false,
  embed = false,
  embedCtx,
  hideDetails = false,
  chrome = true,
  stripePublishableKey = null,
  params,
  initialSlots = null,
}: Props) {
  const [step, setStep] = useState<Step>("calendar");
  const [durationMinutes, setDurationMinutes] = useState(
    params.duration && mt.durations.some((d) => d.minutes === params.duration) ? params.duration : mt.durationMinutes
  );
  const [timezone, setTimezone] = useState(mt.hostTimezone);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    name: params.name,
    email: params.email,
    answers: params.answers,
    guests: params.guests,
    location: mt.locations[0],
    invPhone: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedBooking | null>(null);
  const [payment, setPayment] = useState<{ bookingId: string; token: string; clientSecret: string; expiresAt: string } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const ctx = embedCtx ?? { embedId: null, slug: mt.slug };
  const parentUtm = useParentUtm();
  useEmbedResize(ctx, rootRef);

  const selectedDuration = useMemo(
    () => mt.durations.find((d) => d.minutes === durationMinutes) ?? mt.durations[0],
    [mt.durations, durationMinutes]
  );
  const paid = Boolean(selectedDuration.priceCents && selectedDuration.priceCents > 0);
  const utm = useMemo(() => ({ ...params.utm, ...parentUtm }), [params.utm, parentUtm]);

  function updateForm(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function onDateSelect(date: string) {
    if (embed) emitEmbed(ctx, "date_selected", { date });
  }

  function onSlotSelect(iso: string) {
    setSelectedSlot(iso);
    setStep("details");
    setFormError(null);
    fetch("/api/analytics/slot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: mt.slug }),
    }).catch(() => undefined);
    emitEmbed(
      ctx,
      "slot_selected",
      { startTime: iso, durationMinutes },
      "bookkit.time_selected",
      { slug: mt.slug, startTime: iso, timezone }
    );
  }

  const backToCalendar = useCallback((message?: string) => {
    setPayment(null);
    setSelectedSlot(null);
    setStep("calendar");
    if (message) setFormError(message);
  }, []);

  function finish(booking: ConfirmedBooking, redirectUrl: string | null) {
    emitEmbed(
      ctx,
      "booked",
      { bookingId: booking.id, startTime: booking.startTime, endTime: booking.endTime, name: booking.name, email: booking.email, paid },
      "bookkit.booked",
      { slug: mt.slug, bookingId: booking.id, startTime: booking.startTime, timezone: booking.timezone }
    );
    if (redirectUrl) {
      // The server already appended booking details iff the host enabled redirectPassParams.
      const dest = redirectUrl;
      if (embed) window.open(dest, "_top");
      else window.location.href = dest;
      return;
    }
    if (embed) {
      setConfirmed(booking);
      setStep("confirmed");
    } else {
      window.location.href = `/success?booking=${booking.id}&t=${booking.manageToken ?? ""}`;
    }
  }

  /** Inline payment: poll our own status endpoint until the (possibly late) webhook confirms. */
  const pollUntilConfirmed = useCallback(
    (bookingId: string, token: string) => {
      setStep("confirming");
      let attempts = 0;
      const poll = async () => {
        attempts += 1;
        try {
          const res = await fetch(`/api/bookings/${bookingId}?t=${encodeURIComponent(token)}`, { cache: "no-store" });
          const data = await res.json();
          if (data.ok && data.booking.status === "CONFIRMED") {
            finish(data.booking, data.meetingType?.redirectUrl ?? null);
            return;
          }
          if (data.ok && (data.booking.status === "EXPIRED" || data.booking.status === "CANCELLED")) {
            backToCalendar("That hold expired. Pick a time again.");
            return;
          }
        } catch {
          /* retry */
        }
        if (attempts < 40) setTimeout(poll, 1500);
        else backToCalendar("Still confirming — check your email in a minute, or try again.");
      };
      void poll();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backToCalendar]
  );

  async function submitDetails(payload: DetailsPayload) {
    if (!selectedSlot || submitting) return;
    setSubmitting(true);
    setFormError(null);

    const body = {
      slug: mt.slug,
      name: payload.name,
      email: payload.email,
      timezone,
      answers: payload.answers,
      guests: payload.guests,
      location: payload.location,
      startTime: selectedSlot,
      durationMinutes,
      company: payload.company,
      elapsedMs: payload.elapsedMs,
      utm: Object.keys(utm).length ? utm : undefined,
      link: params.link || undefined,
    };

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!data.ok) {
        if (data.code === "SLOT_TAKEN") {
          backToCalendar(data.error || "That time was just taken. Pick another slot.");
        } else {
          setFormError(data.error || "Something went wrong.");
        }
        return;
      }

      if (data.payment?.clientSecret) {
        setPayment({ bookingId: data.booking.id, token: data.booking.manageToken, clientSecret: data.payment.clientSecret, expiresAt: data.payment.expiresAt });
        setStep("payment");
        emitEmbed(ctx, "payment_started", { bookingId: data.booking.id });
        return;
      }

      if (data.payment?.checkoutUrl) {
        emitEmbed(ctx, "payment_started", { bookingId: data.booking.id });
        if (embed) window.open(data.payment.checkoutUrl, "_top");
        else window.location.href = data.payment.checkoutUrl;
        return;
      }

      finish(data.booking, data.redirectUrl ?? null);
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const accentStyle = { ["--bk-accent" as string]: mt.color } as React.CSSProperties;

  if (blocked) {
    return (
      <div ref={rootRef} style={accentStyle} className="bk-card p-6 sm:p-8 max-w-md mx-auto text-center">
        <h1 className="text-lg font-semibold mb-2">{mt.name}</h1>
        <p className="text-[var(--bk-muted)] text-sm mb-5">Online booking is temporarily unavailable.</p>
        <a className="bk-btn bk-btn-primary" href={`mailto:${hostEmail}?subject=Booking ${encodeURIComponent(mt.name)}`}>
          Email to arrange a time
        </a>
      </div>
    );
  }

  if (step === "confirming") {
    return (
      <div ref={rootRef} style={accentStyle} className="bk-card p-6 sm:p-8 max-w-md mx-auto text-center bk-fade">
        <svg className="bk-spin mx-auto mb-4" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--bk-accent)" strokeWidth="2.5" strokeLinecap="round">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <h2 className="text-lg font-semibold mb-2">Payment received — confirming…</h2>
        <p className="text-[var(--bk-muted)] text-sm">Locking in your time and sending the calendar invite. A few seconds.</p>
      </div>
    );
  }

  if (step === "confirmed" && confirmed) {
    return (
      <div ref={rootRef} style={accentStyle} data-testid="bk-confirmed" className="bk-card p-6 sm:p-8 max-w-md mx-auto">
        <Confirmation booking={confirmed} meetingTypeName={mt.name} showManageLinks={false} />
        {embed && (
          <button type="button" className="bk-btn bk-btn-ghost w-full mt-3" onClick={() => emitEmbed(ctx, "close")}>
            Done
          </button>
        )}
      </div>
    );
  }

  if (step === "payment" && payment && selectedSlot && stripePublishableKey) {
    const when = DateTime.fromISO(selectedSlot, { zone: timezone });
    return (
      <div ref={rootRef} style={accentStyle} className="bk-card p-5 sm:p-7 max-w-md mx-auto bk-fade">
        <button type="button" onClick={() => setStep("details")} className="text-sm text-[var(--bk-muted)] hover:text-[var(--bk-fg)] mb-4 inline-flex items-center gap-1.5">
          <BackIcon /> Back
        </button>
        <h2 className="text-lg font-semibold mb-1">{mt.name}</h2>
        <p className="text-sm mb-1" style={{ color: "var(--bk-accent)" }}>
          {when.toFormat("cccc, LLLL d")} · {when.toFormat("h:mm a")}
        </p>
        <p className="text-xs text-[var(--bk-muted)] mb-5">
          {durationMinutes} min · {when.toFormat("ZZZZ")} · {form.name} ({form.email})
        </p>
        <PaymentStep
          publishableKey={stripePublishableKey}
          clientSecret={payment.clientSecret}
          bookingId={payment.bookingId}
          expiresAt={payment.expiresAt}
          accentColor={mt.color}
          amountLabel={money(selectedDuration.priceCents!, mt.currency)}
          onPaid={(id: string) => pollUntilConfirmed(id, payment.token)}
          onExpired={() => backToCalendar("That hold expired. Pick a time again.")}
        />
      </div>
    );
  }

  if (step === "details" && selectedSlot) {
    const when = DateTime.fromISO(selectedSlot, { zone: timezone });
    return (
      <div ref={rootRef} style={accentStyle} className="bk-card p-5 sm:p-7 max-w-md mx-auto bk-fade">
        <button type="button" onClick={() => backToCalendar()} className="text-sm text-[var(--bk-muted)] hover:text-[var(--bk-fg)] mb-4 inline-flex items-center gap-1.5">
          <BackIcon /> Back
        </button>
        <h2 className="text-lg font-semibold mb-1">{mt.name}</h2>
        <p className="text-sm mb-1" style={{ color: "var(--bk-accent)" }}>
          {when.toFormat("cccc, LLLL d")} · {when.toFormat("h:mm a")}
        </p>
        <p className="text-xs text-[var(--bk-muted)] mb-5">
          {durationMinutes} min · {when.toFormat("ZZZZ")}
          {paid ? ` · ${money(selectedDuration.priceCents!, mt.currency)}` : ""}
        </p>
        <DetailsForm
          meetingType={mt}
          state={form}
          onChange={updateForm}
          error={formError}
          submitting={submitting}
          submitLabel={paid ? (stripePublishableKey ? "Continue to payment" : `Pay ${money(selectedDuration.priceCents!, mt.currency)} and book`) : "Confirm booking"}
          onSubmit={submitDetails}
          onBack={() => backToCalendar()}
        />
      </div>
    );
  }

  /* ---------------- calendar + slots (default step) ---------------- */
  return (
    <div ref={rootRef} style={accentStyle} className="max-w-2xl mx-auto @container">
      <div className="bk-card overflow-hidden">
        {chrome && !hideDetails && (
          <EventDetails meetingType={mt} selectedDuration={selectedDuration} onDurationChange={setDurationMinutes} />
        )}
        <CalendarAndSlots
          slug={mt.slug}
          durationMinutes={durationMinutes}
          linkToken={params.link}
          hostEmail={hostEmail}
          embed={embed}
          initialMonth={params.month}
          initialDate={params.date}
          initialTz={params.tz}
          initialSlots={initialSlots}
          onSlotSelect={onSlotSelect}
          onDateSelect={onDateSelect}
          onTimezoneChange={setTimezone}
          onReady={() => emitEmbed(ctx, "ready")}
        />
      </div>
      {chrome && !embed && (
        <p className="text-center text-xs text-[var(--bk-muted)] mt-4">
          Powered by{" "}
          <a href="https://github.com/nchemb/bookkit" className="underline" target="_blank" rel="noreferrer">
            BookKit
          </a>
        </p>
      )}
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
