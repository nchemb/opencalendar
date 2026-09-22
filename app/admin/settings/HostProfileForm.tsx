"use client";

import { useState } from "react";

export default function HostProfileForm({ timezone, displayName, avatarUrl }: { timezone: string; displayName: string; avatarUrl: string }) {
  const [tz, setTz] = useState(timezone);
  const [name, setName] = useState(displayName);
  const [avatar, setAvatar] = useState(avatarUrl);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/host", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: tz, displayName: name, avatarUrl: avatar || null }),
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
        <span className="bk-label">Display name (shown on booking pages)</span>
        <input className="bk-input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block">
        <span className="bk-label">Avatar URL</span>
        <input className="bk-input" value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://..." />
      </label>
      <label className="block">
        <span className="bk-label">Host timezone (default schedule weekly hours are in this zone)</span>
        <input className="bk-input" value={tz} onChange={(e) => setTz(e.target.value)} />
      </label>
      {note && <p className="text-sm" style={{ color: note.kind === "ok" ? "var(--bk-ok)" : "var(--bk-danger)" }}>{note.text}</p>}
      <button type="button" className="bk-btn bk-btn-primary" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save profile"}
      </button>
    </div>
  );
}
