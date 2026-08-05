"use client";

import { useState } from "react";

export default function SettingsForm({
  webhookUrl,
  webhookSecret,
  timezone,
  displayName,
  hasHost,
}: {
  webhookUrl: string;
  webhookSecret: string;
  timezone: string;
  displayName: string;
  hasHost: boolean;
}) {
  const [url, setUrl] = useState(webhookUrl);
  const [secret, setSecret] = useState(webhookSecret);
  const [tz, setTz] = useState(timezone);
  const [name, setName] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: url,
          webhookSecret: secret,
          ...(hasHost ? { timezone: tz, displayName: name } : {}),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setNote({ kind: "err", text: data.error || "Could not save." });
        return;
      }
      setNote({ kind: "ok", text: "Saved." });
    } catch {
      setNote({ kind: "err", text: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bk-card p-5 space-y-4">
      <div>
        <h2 className="font-semibold mb-1">Outbound webhook</h2>
        <p className="text-sm text-[var(--bk-muted)]">
          POSTed on every confirmed booking with an <code>X-BookKit-Secret</code> header.
          Delivery failures never affect the booking.
        </p>
      </div>

      <div>
        <label className="bk-label">Webhook URL</label>
        <input
          className="bk-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/api/booking-webhook"
        />
      </div>

      <div>
        <label className="bk-label">Shared secret</label>
        <input className="bk-input" value={secret} onChange={(e) => setSecret(e.target.value)} />
      </div>

      {hasHost && (
        <>
          <div className="pt-2 border-t border-[var(--bk-border)]">
            <h2 className="font-semibold mb-1 mt-3">Host</h2>
          </div>
          <div>
            <label className="bk-label">Display name (shown on booking pages)</label>
            <input className="bk-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="bk-label">Host timezone (weekly hours are in this zone)</label>
            <input className="bk-input" value={tz} onChange={(e) => setTz(e.target.value)} />
          </div>
        </>
      )}

      {note && (
        <p className="text-sm" style={{ color: note.kind === "ok" ? "var(--bk-ok)" : "var(--bk-danger)" }}>
          {note.text}
        </p>
      )}

      <button type="button" className="bk-btn bk-btn-primary" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save settings"}
      </button>
    </section>
  );
}
