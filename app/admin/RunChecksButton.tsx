"use client";

import { useState } from "react";

export default function RunChecksButton() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/tick", { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        setNote(data.error || "Failed.");
        return;
      }
      window.location.reload();
    } catch {
      setNote("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" className="bk-btn bk-btn-ghost !py-1.5 !px-3 !text-sm" onClick={run} disabled={busy}>
        {busy ? "Running…" : "Run checks now"}
      </button>
      {note && <span className="text-xs" style={{ color: "var(--bk-danger)" }}>{note}</span>}
    </div>
  );
}
