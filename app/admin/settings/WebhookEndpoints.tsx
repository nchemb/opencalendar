"use client";

import { useState } from "react";
import CopyButton from "@/components/admin/CopyButton";

export type WebhookEndpointRow = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  lastStatus: number | null;
  lastDeliveredAt: string | null;
};

export default function WebhookEndpoints({ endpoints, allEvents }: { endpoints: WebhookEndpointRow[]; allEvents: readonly string[] }) {
  const [rows, setRows] = useState(endpoints);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState<{ id: string; secret: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<Record<string, string>>({});

  function toggleEvent(e: string) {
    setEvents((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));
  }

  async function create() {
    setBusy("new");
    setError(null);
    try {
      const res = await fetch("/api/admin/webhook-endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, events }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Could not create.");
        return;
      }
      setNewSecret({ id: data.id, secret: data.secret });
      setRows((r) => [{ id: data.id, url, events, active: true, lastStatus: null, lastDeliveredAt: null }, ...r]);
      setUrl("");
      setEvents([]);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this webhook endpoint?")) return;
    setBusy(id);
    await fetch(`/api/admin/webhook-endpoints/${id}`, { method: "DELETE" });
    setRows((r) => r.filter((x) => x.id !== id));
    setBusy(null);
  }

  async function test(id: string) {
    setBusy(id);
    setTestNote((n) => ({ ...n, [id]: "Sending…" }));
    try {
      const res = await fetch(`/api/admin/webhook-endpoints/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTestNote((n) => ({ ...n, [id]: data.ok ? `Delivered (${data.status})` : `Failed: ${data.error ?? data.status}` }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-[var(--bk-muted)]">No webhook endpoints yet.</p>}
        {rows.map((r) => (
          <div key={r.id} className="bk-card p-3 space-y-1.5" style={{ background: "var(--bk-surface-2)" }}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <code className="break-all">{r.url}</code>
              <span className="bk-badge bk-badge-muted">{r.events.length ? r.events.join(", ") : "all events"}</span>
              {r.lastStatus !== null && <span className={`bk-badge ${r.lastStatus < 300 ? "bk-badge-ok" : "bk-badge-danger"}`}>last {r.lastStatus}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="bk-btn bk-btn-ghost !py-1 !px-2.5 !text-xs" disabled={busy === r.id} onClick={() => test(r.id)}>
                Send test
              </button>
              <button type="button" className="bk-btn bk-btn-ghost !py-1 !px-2.5 !text-xs" style={{ color: "var(--bk-danger)" }} disabled={busy === r.id} onClick={() => remove(r.id)}>
                Delete
              </button>
              {testNote[r.id] && <span className="text-xs text-[var(--bk-muted)]">{testNote[r.id]}</span>}
            </div>
            {newSecret?.id === r.id && (
              <div className="pt-1.5 flex items-center gap-2">
                <code className="text-xs break-all" style={{ color: "var(--bk-danger)" }}>{newSecret.secret}</code>
                <CopyButton text={newSecret.secret} />
                <span className="text-xs text-[var(--bk-muted)]">shown once — save it now</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="pt-3 border-t border-[var(--bk-border)] space-y-2">
        <input className="bk-input" placeholder="https://example.com/webhooks/bookkit" value={url} onChange={(e) => setUrl(e.target.value)} />
        <div className="flex flex-wrap gap-3">
          {allEvents.map((e) => (
            <label key={e} className="flex items-center gap-1.5 text-xs text-[var(--bk-muted)]">
              <input type="checkbox" checked={events.includes(e)} onChange={() => toggleEvent(e)} />
              {e}
            </label>
          ))}
        </div>
        <p className="text-xs text-[var(--bk-muted)]">No events checked = subscribed to all.</p>
        {error && <p className="text-sm" style={{ color: "var(--bk-danger)" }}>{error}</p>}
        <button type="button" className="bk-btn bk-btn-ghost !text-sm" onClick={create} disabled={busy === "new" || !url}>
          {busy === "new" ? "Creating…" : "+ Add endpoint"}
        </button>
      </div>
    </div>
  );
}
