"use client";

import { useState } from "react";

type Cal = { id: string; summary: string; primary: boolean };

export default function CalendarSelect({ calendars, destination, conflictIds }: { calendars: Cal[]; destination: string; conflictIds: string[] }) {
  const [dest, setDest] = useState(destination);
  const [conflicts, setConflicts] = useState<string[]>(conflictIds);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function toggleConflict(id: string) {
    setConflicts((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/host", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleCalendarId: dest, conflictCalendarIds: conflicts.filter((c) => c !== dest) }),
      });
      const data = await res.json();
      setNote(data.ok ? { kind: "ok", text: "Saved." } : { kind: "err", text: data.error || "Could not save." });
    } catch {
      setNote({ kind: "err", text: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="bk-label">Destination calendar (events are created here)</span>
        <select className="bk-input" value={dest} onChange={(e) => setDest(e.target.value)}>
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>{c.summary}{c.primary ? " (primary)" : ""}</option>
          ))}
        </select>
      </label>
      <div>
        <p className="bk-label">Also block on busy time from</p>
        <div className="space-y-1.5">
          {calendars.filter((c) => c.id !== dest).map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={conflicts.includes(c.id)} onChange={() => toggleConflict(c.id)} />
              {c.summary}
            </label>
          ))}
          {calendars.filter((c) => c.id !== dest).length === 0 && <p className="text-sm text-[var(--bk-muted)]">No other calendars on this account.</p>}
        </div>
      </div>
      {note && <p className="text-sm" style={{ color: note.kind === "ok" ? "var(--bk-ok)" : "var(--bk-danger)" }}>{note.text}</p>}
      <button type="button" className="bk-btn bk-btn-ghost !text-sm" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save calendar selection"}
      </button>
    </div>
  );
}
