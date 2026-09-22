"use client";

import { useEffect, useState } from "react";
import CopyButton from "@/components/admin/CopyButton";

type Link = {
  id: string;
  token: string;
  label: string | null;
  durationMinutes: number | null;
  priceCents: number | null;
  expiresAt: string | null;
  usedAt: string | null;
};

export default function SingleUseLinks({ meetingTypeId, baseUrl, slug }: { meetingTypeId: string; baseUrl: string; slug: string }) {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`/api/admin/event-types/${meetingTypeId}/links`);
    const data = await res.json();
    if (data.ok) setLinks(data.links);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingTypeId]);

  async function create() {
    setBusy(true);
    try {
      await fetch(`/api/admin/event-types/${meetingTypeId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label || null }),
      });
      setLabel("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/admin/event-types/${meetingTypeId}/links/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className="bk-input flex-1 min-w-[160px]" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button type="button" className="bk-btn bk-btn-ghost !text-sm" onClick={create} disabled={busy}>
          + Create link
        </button>
      </div>

      {links === null ? (
        <p className="text-sm text-[var(--bk-muted)]">Loading…</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-[var(--bk-muted)]">No single-use links yet.</p>
      ) : (
        <div className="space-y-2">
          {links.map((l) => {
            const url = `${baseUrl}/${slug}?link=${l.token}`;
            return (
              <div key={l.id} className="bk-card p-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" style={{ background: "var(--bk-surface-2)" }}>
                <span className="font-medium">{l.label || "(no label)"}</span>
                {l.usedAt ? (
                  <span className="bk-badge bk-badge-muted">used</span>
                ) : l.expiresAt && new Date(l.expiresAt) < new Date() ? (
                  <span className="bk-badge bk-badge-warn">expired</span>
                ) : (
                  <span className="bk-badge bk-badge-ok">unused</span>
                )}
                <code className="text-xs text-[var(--bk-muted)] break-all">{url}</code>
                <div className="ml-auto flex items-center gap-2">
                  <CopyButton text={url} />
                  <button type="button" className="text-xs hover:text-[var(--bk-fg)]" style={{ color: "var(--bk-danger)" }} onClick={() => remove(l.id)} disabled={busy}>
                    delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
