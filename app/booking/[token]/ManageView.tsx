"use client";

import { DateTime } from "luxon";
import { useState } from "react";
import CalendarAndSlots from "@/components/booking/CalendarAndSlots";
import Confirmation, { type ConfirmedBooking } from "@/components/booking/Confirmation";
import type { PublicMeetingType } from "@/lib/types";

type Booking = ConfirmedBooking & { status: string };
type Policy = { allowed: boolean; reason?: string; refundOnCancel: boolean };

type Props = {
  token: string;
  booking: Booking;
  meetingType: PublicMeetingType;
  policy: Policy;
  initialAction: "reschedule" | "cancel" | null;
};

type Mode = "view" | "reschedule" | "cancel" | "cancelled" | "rescheduled";

export default function ManageView({ token, booking, meetingType: mt, policy, initialAction }: Props) {
  const [mode, setMode] = useState<Mode>(booking.status === "CANCELLED" ? "cancelled" : initialAction ?? "view");
  const [current, setCurrent] = useState(booking);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refunded, setRefunded] = useState(false);

  const accent = { ["--bk-accent" as string]: mt.color } as React.CSSProperties;
  const start = DateTime.fromISO(current.startTime, { zone: current.timezone });
  const end = DateTime.fromISO(current.endTime, { zone: current.timezone });
  const durationMinutes = Math.round(end.diff(start, "minutes").minutes);
  const rebook = `/${mt.slug}`;

  async function submitCancel() {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "cancel", reason: reason || undefined }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Could not cancel.");
        return;
      }
      setCurrent((c) => ({ ...c, ...data.booking }));
      setRefunded(Boolean(data.refunded));
      setMode("cancelled");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setWorking(false);
    }
  }

  async function submitReschedule(iso: string) {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "reschedule", startTime: iso, reason: reason || undefined }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Could not reschedule.");
        return;
      }
      setCurrent((c) => ({ ...c, ...data.booking }));
      setMode("rescheduled");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setWorking(false);
    }
  }

  if (mode === "cancelled") {
    return (
      <div style={accent} className="bk-card p-7 max-w-md w-full text-center bk-fade">
        <h1 className="text-xl font-semibold mb-2">Booking cancelled</h1>
        <p className="text-[var(--bk-muted)] text-sm mb-6">
          The calendar event has been removed and both sides have been emailed.
          {current.calendarPending === false && refunded ? " Your payment was refunded." : ""}
        </p>
        <a className="bk-btn bk-btn-primary" href={rebook}>
          Book another time
        </a>
      </div>
    );
  }

  if (mode === "rescheduled") {
    return (
      <div style={accent} className="bk-card p-7 max-w-md w-full">
        <h1 className="text-xl font-semibold mb-4">Booking moved</h1>
        <Confirmation booking={current} meetingTypeName={mt.name} showManageLinks={false} />
      </div>
    );
  }

  if (mode === "reschedule") {
    return (
      <div style={accent} className="bk-card overflow-hidden max-w-2xl w-full @container">
        <div className="px-5 sm:px-7 pt-6 pb-5 border-b border-[var(--bk-border)]">
          <button type="button" onClick={() => setMode("view")} className="text-sm text-[var(--bk-muted)] hover:text-[var(--bk-fg)] mb-3 inline-flex items-center gap-1.5">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back
          </button>
          <h1 className="text-lg font-semibold">Pick a new time</h1>
          <p className="text-sm text-[var(--bk-muted)]">{mt.name} · {durationMinutes} min</p>
          {error && <p className="text-sm mt-2" style={{ color: "var(--bk-danger)" }}>{error}</p>}
          {working && <p className="text-sm mt-2 text-[var(--bk-muted)]">Moving your booking…</p>}
        </div>
        <CalendarAndSlots
          slug={mt.slug}
          durationMinutes={durationMinutes}
          hostEmail={mt.hostName}
          onSlotSelect={submitReschedule}
        />
      </div>
    );
  }

  if (mode === "cancel") {
    return (
      <div style={accent} className="bk-card p-7 max-w-md w-full">
        <h1 className="text-xl font-semibold mb-1">Cancel this booking?</h1>
        <p className="text-[var(--bk-muted)] text-sm mb-5">{mt.name}</p>
        <div className="rounded-xl border border-[var(--bk-border)] p-4 mb-5">
          <p className="font-semibold">{start.toFormat("cccc, LLLL d, yyyy")}</p>
          <p className="text-[var(--bk-muted)] text-sm mt-0.5">
            {start.toFormat("h:mm a")} – {end.toFormat("h:mm a")} ({start.toFormat("ZZZZ")})
          </p>
        </div>
        <label className="bk-label" htmlFor="bk-reason">
          Reason <span className="opacity-60">(optional)</span>
        </label>
        <textarea id="bk-reason" className="bk-input resize-y min-h-[64px] mb-3" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        <p className="text-xs text-[var(--bk-muted)] mb-4">
          {policy.refundOnCancel ? "This will be refunded in full." : "This booking is not eligible for an automatic refund."}
        </p>
        {error && <p className="text-sm mb-3" style={{ color: "var(--bk-danger)" }}>{error}</p>}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <button type="button" className="bk-btn bk-btn-primary flex-1" onClick={submitCancel} disabled={working}>
            {working ? "Cancelling…" : "Yes, cancel it"}
          </button>
          <button type="button" className="bk-btn bk-btn-ghost flex-1" onClick={() => setMode("view")}>
            Keep it
          </button>
        </div>
      </div>
    );
  }

  /* ---------------- view ---------------- */
  return (
    <div style={accent} className="bk-card p-7 max-w-md w-full">
      <h1 className="text-xl font-semibold mb-1">{mt.name}</h1>
      <p className="text-[var(--bk-muted)] text-sm mb-5">{current.name} · {current.email}</p>
      <div className="rounded-xl border border-[var(--bk-border)] p-4 mb-5">
        <p className="font-semibold">{start.toFormat("cccc, LLLL d, yyyy")}</p>
        <p className="text-[var(--bk-muted)] text-sm mt-0.5">
          {start.toFormat("h:mm a")} – {end.toFormat("h:mm a")} ({start.toFormat("ZZZZ")})
        </p>
      </div>

      {!policy.allowed ? (
        <p className="text-sm text-[var(--bk-muted)]">{policy.reason}</p>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2.5">
          <button type="button" className="bk-btn bk-btn-primary flex-1" onClick={() => setMode("reschedule")}>
            Reschedule
          </button>
          <button type="button" className="bk-btn bk-btn-ghost flex-1" onClick={() => setMode("cancel")}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
