"use client";

import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicMeetingType } from "@/lib/types";
import PaymentStep from "./PaymentStep";
import { useTimezone } from "./useTimezone";

type Props = {
  meetingType: PublicMeetingType;
  hostEmail: string;
  /** Google is disconnected — show the fallback instead of a calendar. */
  blocked?: boolean;
  embed?: boolean;
  hideDescription?: boolean;
  /** Render header/footer chrome around the picker. */
  chrome?: boolean;
  /** Enables the inline card step; falls back to hosted Checkout when absent. */
  stripePublishableKey?: string | null;
};

type Step = "calendar" | "details" | "payment" | "confirming" | "confirmed";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function post(event: string, detail: Record<string, unknown>) {
  if (typeof window === "undefined" || window.parent === window) return;
  try {
    window.parent.postMessage({ type: event, ...detail }, "*");
  } catch {
    /* cross-origin parent that refuses messages */
  }
}

/** Google Calendar "add event" template — for bookers who skip the invite. */
function addToCalendarUrl(args: {
  title: string;
  startIso: string;
  durationMinutes: number;
  meetLink: string | null;
}) {
  const fmt = (iso: string) =>
    DateTime.fromISO(iso).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
  const end = DateTime.fromISO(args.startIso)
    .plus({ minutes: args.durationMinutes })
    .toUTC()
    .toISO()!;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: args.title,
    dates: `${fmt(args.startIso)}/${fmt(end)}`,
    details: args.meetLink ? `Google Meet: ${args.meetLink}` : "",
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export default function BookingFlow({
  meetingType,
  hostEmail,
  blocked = false,
  embed = false,
  hideDescription = false,
  chrome = true,
  stripePublishableKey = null,
}: Props) {
  const { timezone, setTimezone, zones, ready } = useTimezone();

  const [monthAnchor, setMonthAnchor] = useState<string>(() =>
    DateTime.utc().toFormat("yyyy-MM")
  );
  const [slots, setSlots] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<{ message: string; code?: string } | null>(null);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("calendar");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answer, setAnswer] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{
    id: string;
    startTime: string;
    meetLink: string | null;
    cancelToken: string;
  } | null>(null);
  const [payment, setPayment] = useState<{
    bookingId: string;
    clientSecret: string;
    expiresAt: string;
  } | null>(null);

  const mountedAt = useRef(Date.now());
  const rootRef = useRef<HTMLDivElement>(null);

  const paid = Boolean(meetingType.priceCents && meetingType.priceCents > 0);

  // Once the real timezone is known, anchor the calendar on the booker's current month.
  useEffect(() => {
    if (ready) setMonthAnchor(DateTime.now().setZone(timezone).toFormat("yyyy-MM"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const monthStart = useMemo(
    () => DateTime.fromFormat(monthAnchor, "yyyy-MM", { zone: timezone }).startOf("month"),
    [monthAnchor, timezone]
  );

  const loadSlots = useCallback(async () => {
    if (!ready || blocked) return;
    setLoading(true);
    setLoadError(null);
    try {
      const today = DateTime.now().setZone(timezone).startOf("day");
      const from = monthStart < today ? today : monthStart;
      const to = monthStart.endOf("month");

      if (to < today) {
        setSlots([]);
        return;
      }

      const params = new URLSearchParams({
        slug: meetingType.slug,
        from: from.toFormat("yyyy-MM-dd"),
        to: to.toFormat("yyyy-MM-dd"),
        tz: timezone,
      });
      const res = await fetch(`/api/availability?${params}`, { cache: "no-store" });
      const data = await res.json();

      if (!data.ok) {
        setSlots([]);
        setLoadError({ message: data.error, code: data.code });
        return;
      }
      setSlots(data.slots as string[]);
    } catch {
      setSlots([]);
      setLoadError({ message: "Could not load availability. Check your connection and retry." });
    } finally {
      setLoading(false);
    }
  }, [ready, blocked, monthStart, timezone, meetingType.slug]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  // Keep the host iframe sized to the content in embed mode.
  useEffect(() => {
    if (!embed || !rootRef.current) return;
    const el = rootRef.current;
    const send = () =>
      post("bookkit.resize", { height: Math.ceil(el.getBoundingClientRect().height) + 8 });
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, [embed]);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const iso of slots ?? []) {
      const key = DateTime.fromISO(iso, { zone: timezone }).toFormat("yyyy-MM-dd");
      const list = map.get(key);
      if (list) list.push(iso);
      else map.set(key, [iso]);
    }
    return map;
  }, [slots, timezone]);

  // Auto-select the first day that has slots so the picker is never empty on arrival.
  useEffect(() => {
    if (!slots || selectedDay) return;
    const first = Array.from(slotsByDay.keys()).sort()[0];
    if (first) setSelectedDay(first);
  }, [slots, slotsByDay, selectedDay]);

  const daysInGrid = useMemo(() => {
    const first = monthStart;
    const total = monthStart.daysInMonth ?? 30;
    const lead = first.weekday % 7; // Luxon 1=Mon..7=Sun -> 0=Sun..6=Sat
    const cells: (DateTime | null)[] = Array(lead).fill(null);
    for (let d = 0; d < total; d++) cells.push(first.plus({ days: d }));
    return cells;
  }, [monthStart]);

  const today = DateTime.now().setZone(timezone).startOf("day");
  const canGoBack = monthStart > today.startOf("month");

  function pickSlot(iso: string) {
    setSelectedSlot(iso);
    setStep("details");
    setFormError(null);
    post("bookkit.time_selected", {
      slug: meetingType.slug,
      startTime: iso,
      timezone,
    });
  }

  const slotLost = useCallback(() => {
    setPayment(null);
    setSelectedSlot(null);
    setStep("calendar");
    setFormError("That hold expired. Pick a time again.");
    void loadSlots();
  }, [loadSlots]);

  /** After an inline payment: poll until the webhook confirms, then show it. */
  const onPaid = useCallback(
    (bookingId: string) => {
      post("bookkit.booked", {
        slug: meetingType.slug,
        bookingId,
        startTime: selectedSlot,
        timezone,
      });
      if (!embed) {
        window.location.href = `/success?booking=${bookingId}`;
        return;
      }
      setStep("confirming");
      let attempts = 0;
      const poll = async () => {
        attempts += 1;
        try {
          const res = await fetch(`/api/bookings/${bookingId}`, { cache: "no-store" });
          const data = await res.json();
          if (data.ok && data.booking.status === "CONFIRMED") {
            setConfirmed(data.booking);
            setStep("confirmed");
            return;
          }
        } catch {
          /* retry */
        }
        if (attempts < 40) setTimeout(poll, 1500);
      };
      void poll();
    },
    [embed, meetingType.slug, selectedSlot, timezone]
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot || submitting) return;

    setSubmitting(true);
    setFormError(null);

    const payload = {
      slug: meetingType.slug,
      name,
      email,
      timezone,
      customAnswer: answer || null,
      startTime: selectedSlot,
      company,
      elapsedMs: Date.now() - mountedAt.current,
    };

    // Paid + publishable key => inline card step. Paid without key => hosted Checkout.
    const inlinePay = paid && Boolean(stripePublishableKey);

    try {
      const endpoint = inlinePay
        ? "/api/stripe/intent"
        : paid
          ? "/api/stripe/checkout"
          : "/api/bookings";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!data.ok) {
        setFormError(data.error || "Something went wrong.");
        if (data.code === "SLOT_TAKEN") {
          setSelectedSlot(null);
          setStep("calendar");
          void loadSlots();
        }
        return;
      }

      if (inlinePay) {
        setPayment({
          bookingId: data.bookingId,
          clientSecret: data.clientSecret,
          expiresAt: data.expiresAt,
        });
        setStep("payment");
        post("bookkit.checkout", { slug: meetingType.slug, inline: true });
        return;
      }

      if (paid) {
        post("bookkit.checkout", { slug: meetingType.slug, url: data.checkoutUrl });
        if (embed) window.open(data.checkoutUrl, "_top");
        else window.location.href = data.checkoutUrl;
        return;
      }

      post("bookkit.booked", {
        slug: meetingType.slug,
        bookingId: data.booking.id,
        startTime: data.booking.startTime,
        timezone,
      });

      if (data.redirectUrl) {
        if (embed) window.open(data.redirectUrl, "_top");
        else window.location.href = data.redirectUrl;
        return;
      }

      if (embed) {
        setConfirmed(data.booking);
        setStep("confirmed");
      } else {
        window.location.href = `/success?booking=${data.booking.id}`;
      }
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const accent = { ["--bk-accent" as string]: meetingType.color } as React.CSSProperties;

  /* ---------------- blocked / fallback ---------------- */
  if (blocked) {
    return (
      <div ref={rootRef} style={accent} className="bk-card p-6 sm:p-8 max-w-md mx-auto text-center">
        <h1 className="text-lg font-semibold mb-2">{meetingType.name}</h1>
        <p className="text-[var(--bk-muted)] text-sm mb-5">
          Online booking is temporarily unavailable.
        </p>
        <a className="bk-btn bk-btn-primary" href={`mailto:${hostEmail}?subject=Booking ${encodeURIComponent(meetingType.name)}`}>
          Email to arrange a time
        </a>
      </div>
    );
  }

  /* ---------------- confirming (inline payment, waiting on webhook) ---------------- */
  if (step === "confirming") {
    return (
      <div ref={rootRef} style={accent} className="bk-card p-6 sm:p-8 max-w-md mx-auto text-center bk-fade">
        <svg className="bk-spin mx-auto mb-4" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--bk-accent)" strokeWidth="2.5" strokeLinecap="round">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <h2 className="text-lg font-semibold mb-2">Payment received — confirming…</h2>
        <p className="text-[var(--bk-muted)] text-sm">
          Locking in your time and sending the calendar invite. A few seconds.
        </p>
      </div>
    );
  }

  /* ---------------- confirmed (embed only) ---------------- */
  if (step === "confirmed" && confirmed) {
    const when = DateTime.fromISO(confirmed.startTime, { zone: timezone });
    return (
      <div ref={rootRef} style={accent} className="bk-card p-6 sm:p-8 max-w-md mx-auto bk-fade">
        <div
          className="w-11 h-11 rounded-full grid place-items-center mb-4"
          style={{ background: "color-mix(in srgb, var(--bk-accent) 18%, transparent)" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--bk-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold mb-1">You&apos;re booked</h2>
        <p className="text-[var(--bk-muted)] text-sm mb-5">
          {meetingType.name} — a calendar invite with the Google Meet link is on its way to {email}.
        </p>
        <p className="font-medium mb-1">{when.toFormat("cccc, LLLL d")}</p>
        <p className="text-[var(--bk-muted)] text-sm mb-5">
          {when.toFormat("h:mm a")} – {when.plus({ minutes: meetingType.durationMinutes }).toFormat("h:mm a ZZZZ")}
        </p>
        <a
          className="bk-btn bk-btn-primary w-full"
          href={addToCalendarUrl({
            title: meetingType.name,
            startIso: confirmed.startTime,
            durationMinutes: meetingType.durationMinutes,
            meetLink: confirmed.meetLink,
          })}
          target="_blank"
          rel="noreferrer"
        >
          Add to calendar
        </a>
        {confirmed.meetLink && (
          <p className="text-xs text-[var(--bk-muted)] mt-3 text-center break-all">
            Meet link for when it&apos;s time:{" "}
            <a className="underline" href={confirmed.meetLink} target="_blank" rel="noreferrer">
              {confirmed.meetLink.replace("https://", "")}
            </a>
          </p>
        )}
      </div>
    );
  }

  /* ---------------- inline payment ---------------- */
  if (step === "payment" && payment && selectedSlot && stripePublishableKey) {
    const when = DateTime.fromISO(selectedSlot, { zone: timezone });
    return (
      <div ref={rootRef} style={accent} className="bk-card p-5 sm:p-7 max-w-md mx-auto bk-fade">
        <button
          type="button"
          onClick={() => {
            // Hold stays until it lapses; going back just returns to the form.
            setStep("details");
          }}
          className="text-sm text-[var(--bk-muted)] hover:text-[var(--bk-fg)] mb-4 inline-flex items-center gap-1.5"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </button>

        <h2 className="text-lg font-semibold mb-1">{meetingType.name}</h2>
        <p className="text-sm mb-1" style={{ color: "var(--bk-accent)" }}>
          {when.toFormat("cccc, LLLL d")} · {when.toFormat("h:mm a")}
        </p>
        <p className="text-xs text-[var(--bk-muted)] mb-5">
          {meetingType.durationMinutes} min · {when.toFormat("ZZZZ")} · {name} ({email})
        </p>

        <PaymentStep
          publishableKey={stripePublishableKey}
          clientSecret={payment.clientSecret}
          bookingId={payment.bookingId}
          expiresAt={payment.expiresAt}
          accentColor={meetingType.color}
          amountLabel={money(meetingType.priceCents!, meetingType.currency)}
          onPaid={onPaid}
          onExpired={slotLost}
        />
      </div>
    );
  }

  /* ---------------- details form ---------------- */
  if (step === "details" && selectedSlot) {
    const when = DateTime.fromISO(selectedSlot, { zone: timezone });
    return (
      <div ref={rootRef} style={accent} className="bk-card p-5 sm:p-7 max-w-md mx-auto bk-fade">
        <button
          type="button"
          onClick={() => setStep("calendar")}
          className="text-sm text-[var(--bk-muted)] hover:text-[var(--bk-fg)] mb-4 inline-flex items-center gap-1.5"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </button>

        <h2 className="text-lg font-semibold mb-1">{meetingType.name}</h2>
        <p className="text-sm mb-1" style={{ color: "var(--bk-accent)" }}>
          {when.toFormat("cccc, LLLL d")} · {when.toFormat("h:mm a")}
        </p>
        <p className="text-xs text-[var(--bk-muted)] mb-5">
          {meetingType.durationMinutes} min · {when.toFormat("ZZZZ")}
          {paid ? ` · ${money(meetingType.priceCents!, meetingType.currency)}` : ""}
        </p>

        <form onSubmit={submit} className="space-y-3.5">
          <div>
            <label className="bk-label" htmlFor="bk-name">Name</label>
            <input
              id="bk-name"
              className="bk-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
              autoComplete="name"
            />
          </div>
          <div>
            <label className="bk-label" htmlFor="bk-email">Email</label>
            <input
              id="bk-email"
              className="bk-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
              autoComplete="email"
            />
          </div>
          {meetingType.customQuestion && (
            <div>
              <label className="bk-label" htmlFor="bk-answer">{meetingType.customQuestion}</label>
              <textarea
                id="bk-answer"
                className="bk-input resize-y min-h-[84px]"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                maxLength={2000}
              />
            </div>
          )}

          <input
            type="text"
            name="company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
          />

          {formError && (
            <p className="text-sm" style={{ color: "var(--bk-danger)" }}>{formError}</p>
          )}

          <button type="submit" className="bk-btn bk-btn-primary w-full" disabled={submitting}>
            {submitting ? (
              <>
                <svg className="bk-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                {paid ? "One moment…" : "Booking…"}
              </>
            ) : paid ? (
              stripePublishableKey ? "Continue to payment" : `Pay ${money(meetingType.priceCents!, meetingType.currency)} and book`
            ) : (
              "Confirm booking"
            )}
          </button>

          {paid && (
            <p className="text-xs text-[var(--bk-muted)] text-center">
              {money(meetingType.priceCents!, meetingType.currency)} · secured by Stripe · the time is held for you while you pay
            </p>
          )}
        </form>
      </div>
    );
  }

  /* ---------------- calendar + slots ---------------- */
  const daySlots = selectedDay ? slotsByDay.get(selectedDay) ?? [] : [];

  return (
    <div ref={rootRef} style={accent} className="max-w-3xl mx-auto @container">
      <div className="bk-card overflow-hidden">
        {chrome && (
          <div className="px-5 sm:px-7 pt-6 pb-5 border-b border-[var(--bk-border)]">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--bk-muted)] mb-1.5">
              {meetingType.hostName}
            </p>
            <h1 className="text-xl sm:text-2xl font-semibold mb-2">{meetingType.name}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--bk-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
                </svg>
                {meetingType.durationMinutes} min
              </span>
              <span className="inline-flex items-center gap-1.5">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="2" y="6" width="14" height="12" rx="2" /><path d="m16 10 6-3v10l-6-3z" />
                </svg>
                Google Meet
              </span>
              {paid && (
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  style={{
                    background: "color-mix(in srgb, var(--bk-accent) 16%, transparent)",
                    color: "var(--bk-accent)",
                  }}
                >
                  {money(meetingType.priceCents!, meetingType.currency)}
                </span>
              )}
            </div>
            {!hideDescription && meetingType.description && (
              <p className="mt-3 text-sm text-[var(--bk-muted)] whitespace-pre-line">
                {meetingType.description}
              </p>
            )}
          </div>
        )}

        {/* Container query, not viewport: inside an embed iframe the viewport IS the
            iframe, so the split must follow the widget's own width. */}
        <div className="grid @xl:grid-cols-[1fr_220px]">
          {/* calendar */}
          <div className="p-5 sm:p-6 @xl:border-r border-[var(--bk-border)]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">{monthStart.toFormat("LLLL yyyy")}</h2>
              <div className="flex gap-1">
                <button
                  type="button"
                  aria-label="Previous month"
                  disabled={!canGoBack}
                  onClick={() => setMonthAnchor(monthStart.minus({ months: 1 }).toFormat("yyyy-MM"))}
                  className="w-8 h-8 grid place-items-center rounded-lg border border-[var(--bk-border)] disabled:opacity-30 hover:bg-[var(--bk-surface-2)]"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setMonthAnchor(monthStart.plus({ months: 1 }).toFormat("yyyy-MM"))}
                  className="w-8 h-8 grid place-items-center rounded-lg border border-[var(--bk-border)] hover:bg-[var(--bk-surface-2)]"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAYS.map((d, i) => (
                <div key={i} className="text-center text-[11px] font-medium text-[var(--bk-muted)] py-1">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {daysInGrid.map((day, i) => {
                if (!day) return <div key={`pad-${i}`} />;
                const key = day.toFormat("yyyy-MM-dd");
                const open = (slotsByDay.get(key)?.length ?? 0) > 0;
                const isSelected = key === selectedDay;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!open}
                    onClick={() => {
                      setSelectedDay(key);
                      setSelectedSlot(null);
                    }}
                    className={`bk-day ${
                      isSelected ? "bk-day-selected" : open ? "bk-day-open" : "bk-day-closed"
                    }`}
                  >
                    {day.day}
                  </button>
                );
              })}
            </div>

            {loading && (
              <p className="mt-4 text-xs text-[var(--bk-muted)] flex items-center gap-2">
                <svg className="bk-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Checking the calendar…
              </p>
            )}

            {!loading && loadError && (
              <div className="mt-4 text-sm">
                <p style={{ color: "var(--bk-danger)" }}>{loadError.message}</p>
                {loadError.code === "CALENDAR_DISCONNECTED" ? (
                  <a className="underline text-[var(--bk-muted)]" href={`mailto:${hostEmail}`}>
                    Email {hostEmail} instead
                  </a>
                ) : (
                  <button type="button" onClick={() => void loadSlots()} className="underline text-[var(--bk-muted)]">
                    Try again
                  </button>
                )}
              </div>
            )}

            {!loading && !loadError && slots && slots.length === 0 && (
              <p className="mt-4 text-sm text-[var(--bk-muted)]">
                Nothing open this month. Try the next one.
              </p>
            )}

            <div className="mt-5 pt-4 border-t border-[var(--bk-border)]">
              <label className="bk-label" htmlFor="bk-tz">Timezone</label>
              <select
                id="bk-tz"
                className="bk-input"
                value={timezone}
                onChange={(e) => {
                  setTimezone(e.target.value);
                  setSelectedDay(null);
                  setSelectedSlot(null);
                }}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* slots */}
          <div className="p-5 sm:p-6 border-t @xl:border-t-0 border-[var(--bk-border)]">
            <p className="text-sm font-semibold mb-3">
              {selectedDay
                ? DateTime.fromFormat(selectedDay, "yyyy-MM-dd", { zone: timezone }).toFormat("cccc, LLL d")
                : "Pick a day"}
            </p>
            <div className="bk-scroll flex flex-col gap-2 max-h-[330px] overflow-y-auto pr-1">
              {daySlots.map((iso) => {
                const t = DateTime.fromISO(iso, { zone: timezone });
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => pickSlot(iso)}
                    className={`bk-slot ${selectedSlot === iso ? "bk-slot-active" : ""}`}
                  >
                    {t.toFormat("h:mm a")}
                  </button>
                );
              })}
              {!daySlots.length && !loading && (
                <p className="text-sm text-[var(--bk-muted)]">
                  {selectedDay ? "No times left on this day." : "Select a highlighted day."}
                </p>
              )}
            </div>
          </div>
        </div>
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
