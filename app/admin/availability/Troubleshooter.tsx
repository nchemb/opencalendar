"use client";

import { DateTime } from "luxon";
import { useState } from "react";

type Row = { start: string; reason: string; busySource: string | null };

const REASON_LABEL: Record<string, string> = {
  ok: "Open",
  paused: "Host paused",
  before_min_notice: "Inside minimum notice",
  outside_window: "Outside booking window",
  daily_limit: "Daily limit reached",
  weekly_limit: "Weekly limit reached",
  busy: "Busy",
};

export default function Troubleshooter({ types }: { types: { id: string; name: string; slug: string }[] }) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!typeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/availability/explain?meetingTypeId=${typeId}&date=${date}`);
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Failed.");
        setRows(null);
        return;
      }
      setRows(data.slots);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="bk-label">Event type</span>
          <select className="bk-input" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name} (/{t.slug})</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="bk-label">Date</span>
          <input type="date" className="bk-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button type="button" className="bk-btn bk-btn-ghost !text-sm" onClick={run} disabled={busy || !typeId}>
          {busy ? "Checking…" : "Check"}
        </button>
      </div>

      {error && <p className="text-sm" style={{ color: "var(--bk-danger)" }}>{error}</p>}

      {rows && (
        <div className="bk-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--bk-muted)] border-b border-[var(--bk-border)]">
                <th className="p-3 font-medium">Time</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Busy source</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-3 text-[var(--bk-muted)]">No candidate slots that day (check weekly hours).</td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-[var(--bk-border)] last:border-0">
                  <td className="p-3 tabular-nums">{DateTime.fromISO(r.start).toFormat("h:mm a")}</td>
                  <td className="p-3">
                    <span className={`bk-badge ${r.reason === "ok" ? "bk-badge-ok" : "bk-badge-muted"}`}>{REASON_LABEL[r.reason] ?? r.reason}</span>
                  </td>
                  <td className="p-3 text-[var(--bk-muted)]">{r.busySource ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
