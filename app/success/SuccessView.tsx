"use client";

import { DateTime } from "luxon";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Confirmation, { type ConfirmedBooking } from "@/components/booking/Confirmation";

type Booking = ConfirmedBooking & { status: string };
type MeetingTypeLite = { name: string; slug: string; redirectUrl: string | null; accentColor?: string };

const MAX_ATTEMPTS = 40; // ~60s at 1.5s intervals

export default function SuccessView() {
  const params = useSearchParams();
  const bookingId = params.get("booking");
  const token = params.get("t") ?? "";

  const [booking, setBooking] = useState<Booking | null>(null);
  const [meetingType, setMeetingType] = useState<MeetingTypeLite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirected = useRef(false);

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
        const res = await fetch(`/api/bookings/${bookingId}?t=${encodeURIComponent(token)}`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok) {
          setError(data.error || "Booking not found.");
          return;
        }
        setBooking(data.booking);
        setMeetingType(data.meetingType);
        setAttempts(attempt);

        if (data.booking.status === "CONFIRMED") {
          if (data.meetingType?.redirectUrl && !redirected.current) {
            redirected.current = true;
            window.location.href = data.meetingType.redirectUrl;
          }
          return;
        }
        if (data.booking.status === "PENDING_PAYMENT" && attempt < MAX_ATTEMPTS) {
          timer.current = setTimeout(poll, 1500);
        }
      } catch {
        if (!cancelled && attempt < MAX_ATTEMPTS) timer.current = setTimeout(poll, 2000);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [bookingId, token]);

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

  const accent = { ["--bk-accent" as string]: meetingType?.accentColor || "#FF6A00" } as React.CSSProperties;

  if (booking.status === "PENDING_PAYMENT") {
    const stalled = attempts >= MAX_ATTEMPTS;
    return (
      <div style={accent} className="bk-card p-7 max-w-md w-full text-center">
        {!stalled && (
          <svg className="bk-spin mx-auto mb-4" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--bk-accent)" strokeWidth="2.5" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        )}
        <h1 className="text-lg font-semibold mb-2">{stalled ? "Still confirming" : "Confirming your payment…"}</h1>
        <p className="text-[var(--bk-muted)] text-sm">
          {stalled
            ? "This is taking longer than usual. Your payment is safe — you'll get the calendar invite by email as soon as it clears."
            : "This takes a few seconds. Keep this page open — the calendar invite goes out as soon as it clears."}
        </p>
      </div>
    );
  }

  if (booking.status === "FAILED_NEEDS_INTERVENTION") {
    return (
      <div style={accent} className="bk-card p-7 max-w-md w-full">
        <h1 className="text-lg font-semibold mb-2">Almost there — being confirmed by hand</h1>
        <p className="text-[var(--bk-muted)] text-sm">
          A calendar hiccup stopped the automatic invite. It has been flagged and you will get the invite personally. Nothing else is needed from you.
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
        {meetingType && (
          <a className="bk-btn bk-btn-primary mt-3" href={`/${meetingType.slug}`}>
            Pick a new time
          </a>
        )}
      </div>
    );
  }

  return (
    <div style={accent} className="bk-card p-7 max-w-md w-full">
      <Confirmation booking={booking} meetingTypeName={meetingType?.name ?? ""} />
    </div>
  );
}
