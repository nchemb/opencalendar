"use client";

import { useState } from "react";
import CopyButton from "@/components/admin/CopyButton";

export type ApiKeyRow = { id: string; name: string; prefix: string; lastUsedAt: string | null; revokedAt: string | null };

export default function ApiKeys({ keys }: { keys: ApiKeyRow[] }) {
  const [rows, setRows] = useState(keys);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ id: string; key: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function create() {
    setBusy("new");
    try {
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || "API key" }),
      });
      const data = await res.json();
      if (data.ok) {
        setCreated({ id: data.id, key: data.key });
        setRows((r) => [{ id: data.id, name: name || "API key", prefix: data.key.slice(0, 12), lastUsedAt: null, revokedAt: null }, ...r]);
        setName("");
      }
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this API key? Anything using it stops working immediately.")) return;
    setBusy(id);
    await fetch(`/api/admin/api-keys/${id}`, { method: "DELETE" });
    setRows((r) => r.map((k) => (k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k)));
    setBusy(null);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-[var(--bk-muted)]">No API keys yet.</p>}
        {rows.map((k) => (
          <div key={k.id} className="bk-card p-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" style={{ background: "var(--bk-surface-2)" }}>
            <span className="font-medium">{k.name}</span>
            <code className="text-xs text-[var(--bk-muted)]">{k.prefix}…</code>
            {k.revokedAt ? (
              <span className="bk-badge bk-badge-muted">revoked</span>
            ) : (
              <span className="bk-badge bk-badge-ok">active</span>
            )}
            {k.lastUsedAt && <span className="text-xs text-[var(--bk-muted)]">last used {new Date(k.lastUsedAt).toLocaleDateString()}</span>}
            {!k.revokedAt && (
              <button type="button" className="text-xs ml-auto hover:text-[var(--bk-fg)]" style={{ color: "var(--bk-danger)" }} disabled={busy === k.id} onClick={() => revoke(k.id)}>
                Revoke
              </button>
            )}
            {created?.id === k.id && (
              <div className="w-full pt-1.5 flex items-center gap-2">
                <code className="text-xs break-all" style={{ color: "var(--bk-danger)" }}>{created.key}</code>
                <CopyButton text={created.key} />
                <span className="text-xs text-[var(--bk-muted)]">shown once — save it now</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-3 border-t border-[var(--bk-border)]">
        <input className="bk-input flex-1 min-w-[160px]" placeholder="Key name (e.g. Zapier)" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="bk-btn bk-btn-ghost !text-sm" onClick={create} disabled={busy === "new"}>
          {busy === "new" ? "Creating…" : "+ Create key"}
        </button>
      </div>
    </div>
  );
}
