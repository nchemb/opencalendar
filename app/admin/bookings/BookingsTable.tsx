"use client";

import { DateTime } from "luxon";
import { useMemo, useState } from "react";

export type AdminBooking = {
  id: string;
  name: string;
  email: string;
  status: string;
  startTime: string;
  endTime: string;
  bookerTimezone: string;
  meetLink: string | null;
  amountCents: number | null;
  paymentStatus: string | null;
  customAnswer: string | null;
  syncError: string | null;
  cancelToken: string;
  createdAt: string;
  meetingType: { name: string; color: string; slug: string };
};

const STATUSES = [
  "ALL",
  "CONFIRMED",
  "FAILED_NEEDS_INTERVENTION",
  "PENDING_PAYMENT",
  "CANCELLED",
  "EXPIRED",
];

const LABEL: Record<string, string> = {
  CONFIRMED: "Confirmed",
  FAILED_NEEDS_INTERVENTION: "Needs attention",
  PENDING_PAYMENT: "Holding",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

function statusColor(status: string) {
  if (status === "CONFIRMED") return "var(--bk-ok)";
  if (status === "FAILED_NEEDS_INTERVENTION") return "var(--bk-danger)";
  return "var(--bk-muted)";
}

export default function BookingsTable({
  bookings,
  hostTimezone,
  initialStatus,
}: {
  bookings: AdminBooking[];
  hostTimezone: string;
  initialStatus: string;
}) {
  const [status, setStatus] = useState(
    STATUSES.includes(initialStatus) ? initialStatus : "ALL"
  );
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookings.filter((b) => {
      if (status !== "ALL" && b.status !== status) return false;
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        b.email.toLowerCase().includes(q) ||
        b.meetingType.name.toLowerCase().includes(q)
      );
    });
  }, [bookings, status, query]);

  const failed = bookings.filter((b) => b.status === "FAILED_NEEDS_INTERVENTION");

  async function act(id: string, action: "cancel" | "retry") {
    if (action === "cancel" && !confirm("Cancel this booking and remove the calendar event?")) return;
    setBusyId(id);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/bookings/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!data.ok) {
        setNote(data.error || "Action failed.");
        return;
      }
      window.location.reload();
    } catch {
      setNote("Network error.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Bookings</h1>
        <p className="text-[var(--bk-muted)] text-sm">Times shown in {hostTimezone}.</p>
      </div>

      {failed.length > 0 && status !== "FAILED_NEEDS_INTERVENTION" && (
        <button
          type="button"
          className="bk-card p-4 w-full text-left"
          style={{ borderColor: "var(--bk-danger)" }}
          onClick={() => setStatus("FAILED_NEEDS_INTERVENTION")}
        >
          <span className="font-semibold" style={{ color: "var(--bk-danger)" }}>
            {failed.length} booking{failed.length > 1 ? "s" : ""} need manual attention
          </span>
          <span className="text-sm text-[var(--bk-muted)] block mt-0.5">
            Click to filter, then retry the calendar event.
          </span>
        </button>
      )}

      <div className="flex flex-wrap gap-2.5">
        <input
          className="bk-input flex-1 min-w-[200px]"
          placeholder="Search name, email or type"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="bk-input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All statuses" : LABEL[s] ?? s}
            </option>
          ))}
        </select>
      </div>

      {note && <p className="text-sm" style={{ color: "var(--bk-danger)" }}>{note}</p>}

      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-[var(--bk-muted)] text-sm">No bookings match.</p>
        )}
        {filtered.map((b) => {
          const start = DateTime.fromISO(b.startTime, { zone: hostTimezone });
          const isOpen = expanded === b.id;
          return (
            <div key={b.id} className="bk-card p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: b.meetingType.color }} />
                <span className="font-medium tabular-nums">{start.toFormat("ccc LLL d, h:mm a")}</span>
                <span className="text-sm text-[var(--bk-muted)]">{b.meetingType.name}</span>
                <span className="text-sm">{b.name}</span>
                <span className="text-sm text-[var(--bk-muted)]">{b.email}</span>
                {b.amountCents ? (
                  <span className="text-sm text-[var(--bk-muted)]">
                    ${(b.amountCents / 100).toFixed(0)} {b.paymentStatus ?? ""}
                  </span>
                ) : null}
                <span className="text-xs font-semibold ml-auto" style={{ color: statusColor(b.status) }}>
                  {LABEL[b.status] ?? b.status}
                </span>
                <button
                  type="button"
                  className="text-xs underline text-[var(--bk-muted)]"
                  onClick={() => setExpanded(isOpen ? null : b.id)}
                >
                  {isOpen ? "less" : "more"}
                </button>
              </div>

              {isOpen && (
                <div className="mt-3 pt-3 border-t border-[var(--bk-border)] text-sm space-y-2">
                  <p className="text-[var(--bk-muted)]">
                    Their timezone: {b.bookerTimezone} · booked{" "}
                    {DateTime.fromISO(b.createdAt, { zone: hostTimezone }).toFormat("LLL d, h:mm a")}
                  </p>
                  {b.customAnswer && (
                    <p className="whitespace-pre-line">
                      <span className="text-[var(--bk-muted)]">Answer: </span>
                      {b.customAnswer}
                    </p>
                  )}
                  {b.syncError && (
                    <p style={{ color: "var(--bk-danger)" }} className="break-all">
                      {b.syncError}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {b.meetLink && (
                      <button
                        type="button"
                        className="bk-btn bk-btn-ghost !py-1.5 !px-3 !text-sm"
                        onClick={() => navigator.clipboard.writeText(b.meetLink!)}
                      >
                        Copy Meet link
                      </button>
                    )}
                    {b.status === "FAILED_NEEDS_INTERVENTION" && (
                      <button
                        type="button"
                        className="bk-btn bk-btn-primary !py-1.5 !px-3 !text-sm"
                        disabled={busyId === b.id}
                        onClick={() => act(b.id, "retry")}
                      >
                        {busyId === b.id ? "Retrying…" : "Retry calendar event"}
                      </button>
                    )}
                    {b.status === "CONFIRMED" && (
                      <button
                        type="button"
                        className="bk-btn bk-btn-ghost !py-1.5 !px-3 !text-sm"
                        style={{ color: "var(--bk-danger)" }}
                        disabled={busyId === b.id}
                        onClick={() => act(b.id, "cancel")}
                      >
                        Cancel booking
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
