"use client";

import { DateTime } from "luxon";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Booking = {
  id: string;
  status: string;
  startTime: string;
  endTime: string;
  timezone: string;
  name: string;
  meetLink: string | null;
  cancelToken: string | null;
  meetingType: { name: string; slug: string; color: string; redirectUrl: string | null };
};

/** Google Calendar "add event" URL, for people who did not accept the invite. */
function addToCalendarUrl(b: Booking) {
  const fmt = (iso: string) =>
    DateTime.fromISO(iso).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: b.meetingType.name,
    dates: `${fmt(b.startTime)}/${fmt(b.endTime)}`,
    details: b.meetLink ? `Google Meet: ${b.meetLink}` : "",
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export default function SuccessView() {
  const params = useSearchParams();
  const bookingId = params.get("booking");

  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waited, setWaited] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!bookingId) {
      setError("No booking reference in the link.");
      return;
    }

    let cancelled = false;
    let attempt = 0;

    async function poll() {
      attempt += 1;
      try {
        const res = await fetch(`/api/bookings/${bookingId}`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;

        if (!data.ok) {
          setError(data.error || "Booking not found.");
          return;
        }

        setBooking(data.booking);
        setWaited(attempt);

        // Paid bookings land here before the Stripe webhook has confirmed them.
        if (data.booking.status === "PENDING_PAYMENT" && attempt < 40) {
          timer.current = setTimeout(poll, 1500);
        }
      } catch {
        if (!cancelled && attempt < 40) timer.current = setTimeout(poll, 2000);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [bookingId]);

  if (error) {
    return (
      <div className="bk-card p-7 max-w-md w-full text-center">
        <h1 className="text-lg font-semibold mb-2">Hmm</h1>
        <p className="text-[var(--bk-muted)] text-sm">{error}</p>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="bk-card p-7 max-w-md w-full text-center">
        <p className="text-[var(--bk-muted)] text-sm inline-flex items-center gap-2">
          <svg className="bk-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          Loading your booking…
        </p>
      </div>
    );
  }

  const accent = { ["--bk-accent" as string]: booking.meetingType.color } as React.CSSProperties;
  const start = DateTime.fromISO(booking.startTime, { zone: booking.timezone });
  const end = DateTime.fromISO(booking.endTime, { zone: booking.timezone });

  if (booking.status === "PENDING_PAYMENT") {
    return (
      <div style={accent} className="bk-card p-7 max-w-md w-full text-center">
        <svg className="bk-spin mx-auto mb-4" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--bk-accent)" strokeWidth="2.5" strokeLinecap="round">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <h1 className="text-lg font-semibold mb-2">Confirming your payment…</h1>
        <p className="text-[var(--bk-muted)] text-sm">
          This takes a few seconds. Keep this page open — the calendar invite goes out as soon as it clears.
        </p>
        {waited > 20 && (
          <p className="text-[var(--bk-muted)] text-xs mt-4">
            Taking longer than usual. Your payment is safe — you will get the invite by email either way.
          </p>
        )}
      </div>
    );
  }

  if (booking.status === "FAILED_NEEDS_INTERVENTION") {
    return (
      <div style={accent} className="bk-card p-7 max-w-md w-full">
        <h1 className="text-lg font-semibold mb-2">Almost there — being confirmed by hand</h1>
        <p className="text-[var(--bk-muted)] text-sm mb-4">
          A calendar hiccup stopped the automatic invite for {start.toFormat("cccc, LLLL d 'at' h:mm a")}. It has been flagged and you will get the invite personally. Nothing else is needed from you.
        </p>
      </div>
    );
  }

  if (booking.status === "CANCELLED" || booking.status === "EXPIRED") {
    return (
      <div style={accent} className="bk-card p-7 max-w-md w-full text-center">
        <h1 className="text-lg font-semibold mb-2">
          {booking.status === "CANCELLED" ? "This booking was cancelled" : "This hold expired"}
        </h1>
        <a className="bk-btn bk-btn-primary mt-3" href={`/${booking.meetingType.slug}`}>
          Pick a new time
        </a>
      </div>
    );
  }

  return (
    <div style={accent} className="bk-card p-7 max-w-md w-full bk-fade">
      <div
        className="w-11 h-11 rounded-full grid place-items-center mb-5"
        style={{ background: "color-mix(in srgb, var(--bk-accent) 18%, transparent)" }}
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--bk-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>

      <h1 className="text-2xl font-semibold mb-1">You&apos;re booked</h1>
      <p className="text-[var(--bk-muted)] text-sm mb-6">
        {booking.meetingType.name} · a calendar invite from Google is on its way.
      </p>

      <div className="rounded-xl border border-[var(--bk-border)] p-4 mb-5">
        <p className="font-semibold">{start.toFormat("cccc, LLLL d, yyyy")}</p>
        <p className="text-[var(--bk-muted)] text-sm mt-0.5">
          {start.toFormat("h:mm a")} – {end.toFormat("h:mm a")} ({start.toFormat("ZZZZ")})
        </p>
      </div>

      <a className="bk-btn bk-btn-primary w-full" href={addToCalendarUrl(booking)} target="_blank" rel="noreferrer">
        Add to calendar
      </a>
      {booking.meetLink && (
        <p className="text-xs text-[var(--bk-muted)] mt-3 text-center break-all">
          Meet link for when it&apos;s time:{" "}
          <a className="underline" href={booking.meetLink} target="_blank" rel="noreferrer">
            {booking.meetLink.replace("https://", "")}
          </a>
        </p>
      )}

      {booking.cancelToken && (
        <p className="text-xs text-[var(--bk-muted)] mt-5 text-center">
          Need to change it?{" "}
          <a className="underline" href={`/cancel/${booking.cancelToken}`}>
            Cancel this booking
          </a>
        </p>
      )}
    </div>
  );
}
