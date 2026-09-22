"use client";

import { useState } from "react";

export default function DataPrivacy() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(action: "export" | "delete") {
    if (!email) return;
    if (action === "delete" && !confirm(`Anonymize all bookings for ${email}? This cannot be undone.`)) return;
    setBusy(action);
    setNote(null);
    try {
      const res = await fetch("/api/admin/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email }),
      });
      const data = await res.json();
      if (!data.ok) {
        setNote(data.error || "Failed.");
        return;
      }
      if (action === "delete") {
        setNote(`Anonymized ${data.anonymized} booking${data.anonymized === 1 ? "" : "s"}.`);
      } else {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `bookkit-${email}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setNote("Exported.");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block flex-1 min-w-[220px]">
        <span className="bk-label">Invitee email</span>
        <input className="bk-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com" />
      </label>
      <button type="button" className="bk-btn bk-btn-ghost !text-sm" onClick={() => run("export")} disabled={busy !== null || !email}>
        {busy === "export" ? "Exporting…" : "Export JSON"}
      </button>
      <button type="button" className="bk-btn bk-btn-ghost !text-sm" style={{ color: "var(--bk-danger)" }} onClick={() => run("delete")} disabled={busy !== null || !email}>
        {busy === "delete" ? "Deleting…" : "Delete data"}
      </button>
      {note && <p className="text-sm text-[var(--bk-muted)] w-full">{note}</p>}
    </div>
  );
}
