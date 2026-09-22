"use client";

import { useState } from "react";

export default function AlertChannels({ alertEmailSet, alertWebhookSet, hostEmail }: { alertEmailSet: boolean; alertWebhookSet: boolean; hostEmail: string | null }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function sendTest() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/alerts/test", { method: "POST" });
      const data = await res.json();
      setNote(data.ok ? "Sent — check the alert banner and your alert channels." : data.error || "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bk-card p-5">
      <h2 className="font-semibold mb-1">Alert channels</h2>
      <p className="text-sm text-[var(--bk-muted)] mb-3">Where host alerts (calendar down, double-booking risk, dead jobs) get sent, in addition to the admin banner.</p>
      <ul className="text-sm space-y-1.5 mb-4">
        <li className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: alertEmailSet || hostEmail ? "var(--bk-ok)" : "var(--bk-danger)" }} />
          <code>ALERT_EMAIL</code>
          <span className="text-[var(--bk-muted)]">{alertEmailSet ? "set" : hostEmail ? `not set — falls back to host email (${hostEmail})` : "not set"}</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: alertWebhookSet ? "var(--bk-ok)" : "var(--bk-muted)" }} />
          <code>ALERT_WEBHOOK_URL</code>
          <span className="text-[var(--bk-muted)]">{alertWebhookSet ? "set (Slack/Discord/ntfy/generic JSON)" : "not set (optional)"}</span>
        </li>
      </ul>
      <button type="button" className="bk-btn bk-btn-ghost !text-sm" onClick={sendTest} disabled={busy}>
        {busy ? "Sending…" : "Send test alert"}
      </button>
      {note && <p className="text-sm mt-2 text-[var(--bk-muted)]">{note}</p>}
    </section>
  );
}
