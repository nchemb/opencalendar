"use client";

import { useState } from "react";

export default function PauseSwitch({
  paused: initialPaused,
  pausedMessage: initialMessage,
}: {
  paused: boolean;
  pausedMessage: string;
}) {
  const [paused, setPaused] = useState(initialPaused);
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function save(nextPaused: boolean) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: nextPaused, pausedMessage: message }),
      });
      const data = await res.json();
      if (!data.ok) {
        setNote(data.error || "Could not save.");
        return;
      }
      setPaused(nextPaused);
    } catch {
      setNote("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bk-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-sm">Pause bookings</p>
          <p className="text-xs text-[var(--bk-muted)]">Links show a friendly &ldquo;not taking bookings&rdquo; message instead of a calendar.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={paused}
          disabled={busy}
          onClick={() => save(!paused)}
          className="bk-btn !py-1.5 !px-4 !text-sm"
          style={{ background: paused ? "var(--bk-danger)" : "var(--bk-surface-2)", color: paused ? "#fff" : "var(--bk-fg)", border: "1px solid var(--bk-border)" }}
        >
          {paused ? "Paused — resume" : "Pause"}
        </button>
      </div>
      {paused && (
        <input
          className="bk-input"
          placeholder="Message shown to visitors (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onBlur={() => save(true)}
        />
      )}
      {note && <p className="text-xs" style={{ color: "var(--bk-danger)" }}>{note}</p>}
    </div>
  );
}
