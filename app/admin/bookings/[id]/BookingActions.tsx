"use client";

import { DateTime } from "luxon";
import { useState } from "react";

type Props = {
  booking: {
    id: string;
    status: string;
    noShow: boolean;
    paid: boolean;
    hasGoogleEvent: boolean;
    meetingTypeSlug: string;
    durationMinutes: number;
    startTime: string;
  };
  hostTimezone: string;
};

async function post(url: string, body?: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

export default function BookingActions({ booking, hostTimezone }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"cancel" | "reschedule" | null>(null);

  // Cancel panel state
  const [cancelReason, setCancelReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [refund, setRefund] = useState(booking.paid);

  // Reschedule panel state
  const [newStart, setNewStart] = useState(booking.startTime.slice(0, 16));
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [helperDate, setHelperDate] = useState(DateTime.fromISO(booking.startTime, { zone: hostTimezone }).toFormat("yyyy-MM-dd"));
  const [helperSlots, setHelperSlots] = useState<string[] | null>(null);
  const [helperBusy, setHelperBusy] = useState(false);

  async function run(action: string, body?: Record<string, unknown>) {
    setBusy(action);
    setError(null);
    const data = await post(`/api/admin/bookings/${booking.id}`, { action, ...body });
    setBusy(null);
    if (!data.ok) {
      setError(data.error || "Action failed.");
      return false;
    }
    window.location.reload();
    return true;
  }

  async function loadHelperSlots() {
    setHelperBusy(true);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}/slots?date=${helperDate}`);
      const data = await res.json();
      setHelperSlots(data.ok ? data.slots : []);
    } finally {
      setHelperBusy(false);
    }
  }

  return (
    <section className="bk-card p-5 space-y-4">
      <h2 className="font-semibold">Actions</h2>
      {error && <p className="text-sm" style={{ color: "var(--bk-danger)" }}>{error}</p>}

      <div className="flex flex-wrap gap-2">
        {!booking.hasGoogleEvent && booking.status !== "CANCELLED" && (
          <button type="button" className="bk-btn bk-btn-ghost !text-sm" disabled={busy === "retry"} onClick={() => run("retry")}>
            {busy === "retry" ? "Retrying…" : "Retry calendar event"}
          </button>
        )}
        {booking.status === "CONFIRMED" && (
          <button
            type="button"
            className="bk-btn bk-btn-ghost !text-sm"
            disabled={busy === "no_show"}
            onClick={() => run("no_show", { noShow: !booking.noShow })}
          >
            {busy === "no_show" ? "…" : booking.noShow ? "Undo no-show" : "Mark no-show"}
          </button>
        )}
        {booking.paid && (
          <button
            type="button"
            className="bk-btn bk-btn-ghost !text-sm"
            disabled={busy === "refund"}
            onClick={() => {
              if (confirm("Refund this booking in full?")) run("refund");
            }}
          >
            {busy === "refund" ? "Refunding…" : "Refund"}
          </button>
        )}
        {booking.status === "CONFIRMED" && (
          <button type="button" className="bk-btn bk-btn-ghost !text-sm" disabled={busy === "resend"} onClick={() => run("resend")}>
            {busy === "resend" ? "Sending…" : "Resend confirmation email"}
          </button>
        )}
        {booking.status === "CONFIRMED" && (
          <button
            type="button"
            className="bk-btn bk-btn-ghost !text-sm"
            onClick={() => setPanel(panel === "reschedule" ? null : "reschedule")}
          >
            Reschedule
          </button>
        )}
        {booking.status === "CONFIRMED" && (
          <button
            type="button"
            className="bk-btn bk-btn-ghost !text-sm"
            style={{ color: "var(--bk-danger)" }}
            onClick={() => setPanel(panel === "cancel" ? null : "cancel")}
          >
            Cancel booking
          </button>
        )}
      </div>

      {panel === "cancel" && (
        <div className="pt-3 border-t border-[var(--bk-border)] space-y-3">
          <textarea
            className="bk-input min-h-[70px]"
            placeholder="Reason (shown to you, optional)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              Notify invitee
            </label>
            {booking.paid && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
                Refund payment
              </label>
            )}
          </div>
          <button
            type="button"
            className="bk-btn bk-btn-primary !text-sm"
            style={{ background: "var(--bk-danger)", color: "#fff" }}
            disabled={busy === "cancel"}
            onClick={() => run("cancel", { reason: cancelReason, notify, refund })}
          >
            {busy === "cancel" ? "Cancelling…" : "Confirm cancel"}
          </button>
        </div>
      )}

      {panel === "reschedule" && (
        <div className="pt-3 border-t border-[var(--bk-border)] space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="bk-label">Find open slots on</label>
              <input type="date" className="bk-input" value={helperDate} onChange={(e) => setHelperDate(e.target.value)} />
            </div>
            <button type="button" className="bk-btn bk-btn-ghost !py-2.5 !text-sm" onClick={loadHelperSlots} disabled={helperBusy}>
              {helperBusy ? "Loading…" : "Show open slots"}
            </button>
          </div>
          {helperSlots && (
            <div className="flex flex-wrap gap-2">
              {helperSlots.length === 0 && <p className="text-sm text-[var(--bk-muted)]">No open slots that day.</p>}
              {helperSlots.map((iso) => (
                <button
                  key={iso}
                  type="button"
                  className="bk-btn bk-btn-ghost !py-1.5 !px-3 !text-sm"
                  onClick={() => setNewStart(DateTime.fromISO(iso, { zone: hostTimezone }).toFormat("yyyy-MM-dd'T'HH:mm"))}
                >
                  {DateTime.fromISO(iso, { zone: hostTimezone }).toFormat("h:mm a")}
                </button>
              ))}
            </div>
          )}
          <div>
            <label className="bk-label">New start time ({hostTimezone}) — you may pick any time, not just the grid</label>
            <input type="datetime-local" className="bk-input" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
          </div>
          <input
            className="bk-input"
            placeholder="Note to invitee (optional)"
            value={rescheduleReason}
            onChange={(e) => setRescheduleReason(e.target.value)}
          />
          <button
            type="button"
            className="bk-btn bk-btn-primary !text-sm"
            disabled={busy === "reschedule"}
            onClick={() => {
              const iso = DateTime.fromISO(newStart, { zone: hostTimezone }).toUTC().toISO();
              if (!iso) {
                setError("Invalid date/time.");
                return;
              }
              run("reschedule", { startTime: iso, reason: rescheduleReason });
            }}
          >
            {busy === "reschedule" ? "Saving…" : "Confirm reschedule"}
          </button>
        </div>
      )}
    </section>
  );
}
