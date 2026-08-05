"use client";

import { DateTime } from "luxon";
import { useState } from "react";

type Booking = {
  status: string;
  startTime: string;
  endTime: string;
  timezone: string;
  name: string;
  paid: boolean;
  meetingType: { name: string; slug: string; color: string };
};

export default function CancelView({ token, booking }: { token: string; booking: Booking }) {
  const [state, setState] = useState<"idle" | "working" | "done">(
    booking.status === "CANCELLED" ? "done" : "idle"
  );
  const [error, setError] = useState<string | null>(null);

  const accent = { ["--bk-accent" as string]: booking.meetingType.color } as React.CSSProperties;
  const start = DateTime.fromISO(booking.startTime, { zone: booking.timezone });
  const end = DateTime.fromISO(booking.endTime, { zone: booking.timezone });
  const rebook = `/${booking.meetingType.slug}`;

  async function cancel() {
    setState("working");
    setError(null);
    try {
      const res = await fetch("/api/bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Could not cancel.");
        setState("idle");
        return;
      }
      setState("done");
    } catch {
      setError("Network error. Please try again.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <div style={accent} className="bk-card p-7 max-w-md w-full text-center bk-fade">
        <h1 className="text-xl font-semibold mb-2">Booking cancelled</h1>
        <p className="text-[var(--bk-muted)] text-sm mb-6">
          The calendar event has been removed and both sides have been emailed.
          {booking.paid ? " Refunds are handled personally — reply to your confirmation email." : ""}
        </p>
        <a className="bk-btn bk-btn-primary" href={rebook}>
          Book another time
        </a>
      </div>
    );
  }

  if (booking.status !== "CONFIRMED") {
    return (
      <div style={accent} className="bk-card p-7 max-w-md w-full text-center">
        <h1 className="text-lg font-semibold mb-2">Nothing to cancel</h1>
        <p className="text-[var(--bk-muted)] text-sm mb-6">This booking is not active.</p>
        <a className="bk-btn bk-btn-primary" href={rebook}>
          Book a time
        </a>
      </div>
    );
  }

  return (
    <div style={accent} className="bk-card p-7 max-w-md w-full">
      <h1 className="text-xl font-semibold mb-1">Cancel this booking?</h1>
      <p className="text-[var(--bk-muted)] text-sm mb-5">{booking.meetingType.name}</p>

      <div className="rounded-xl border border-[var(--bk-border)] p-4 mb-5">
        <p className="font-semibold">{start.toFormat("cccc, LLLL d, yyyy")}</p>
        <p className="text-[var(--bk-muted)] text-sm mt-0.5">
          {start.toFormat("h:mm a")} – {end.toFormat("h:mm a")} ({start.toFormat("ZZZZ")})
        </p>
      </div>

      {booking.paid && (
        <p className="text-xs text-[var(--bk-muted)] mb-4">
          This booking was paid. Cancelling here does not issue an automatic refund — reply to your confirmation email and it will be handled personally.
        </p>
      )}

      {error && <p className="text-sm mb-3" style={{ color: "var(--bk-danger)" }}>{error}</p>}

      <div className="flex flex-col sm:flex-row gap-2.5">
        <button
          type="button"
          className="bk-btn bk-btn-primary flex-1"
          onClick={cancel}
          disabled={state === "working"}
        >
          {state === "working" ? "Cancelling…" : "Yes, cancel it"}
        </button>
        <a className="bk-btn bk-btn-ghost flex-1" href={rebook}>
          Keep it
        </a>
      </div>
    </div>
  );
}
