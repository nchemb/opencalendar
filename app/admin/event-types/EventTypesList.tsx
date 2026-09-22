"use client";

import Link from "next/link";
import { useState } from "react";

export type EventTypeRow = {
  id: string;
  slug: string;
  name: string;
  durationMinutes: number;
  priceCents: number | null;
  color: string;
  active: boolean;
  secret: boolean;
  brandName: string | null;
};

export default function EventTypesList({ types }: { types: EventTypeRow[] }) {
  const [rows, setRows] = useState(types);
  const [busy, setBusy] = useState<string | null>(null);

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next);
    await Promise.all(next.map((r, i) => fetch(`/api/admin/event-types/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: i }),
    })));
  }

  async function toggleActive(id: string, active: boolean) {
    setBusy(id);
    await fetch(`/api/admin/event-types/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    setRows((r) => r.map((x) => (x.id === id ? { ...x, active } : x)));
    setBusy(null);
  }

  async function duplicate(id: string) {
    setBusy(id);
    const res = await fetch(`/api/admin/event-types/${id}/duplicate`, { method: "POST" });
    const data = await res.json();
    setBusy(null);
    if (data.ok) window.location.href = `/admin/event-types/${data.id}`;
  }

  if (rows.length === 0) return <p className="text-[var(--bk-muted)] text-sm">No event types yet.</p>;

  return (
    <div className="space-y-2">
      {rows.map((m, i) => (
        <div key={m.id} className="bk-card p-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex flex-col gap-0.5 -my-1">
            <button type="button" className="text-xs text-[var(--bk-muted)] hover:text-[var(--bk-fg)] disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}>
              ▲
            </button>
            <button
              type="button"
              className="text-xs text-[var(--bk-muted)] hover:text-[var(--bk-fg)] disabled:opacity-30"
              disabled={i === rows.length - 1}
              onClick={() => move(i, 1)}
            >
              ▼
            </button>
          </div>
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: m.color }} />
          <span className="font-medium">{m.name}</span>
          <code className="text-xs text-[var(--bk-muted)]">/{m.slug}</code>
          {m.brandName && <span className="bk-badge bk-badge-muted">{m.brandName}</span>}
          <span className="text-sm text-[var(--bk-muted)]">{m.durationMinutes} min</span>
          <span className="text-sm text-[var(--bk-muted)]">{m.priceCents ? `$${(m.priceCents / 100).toFixed(0)}` : "Free"}</span>
          {m.secret && <span className="bk-badge bk-badge-muted">secret</span>}
          {!m.active && <span className="bk-badge bk-badge-warn">inactive</span>}
          <div className="ml-auto flex gap-2">
            <button type="button" className="bk-btn bk-btn-ghost !py-1.5 !px-3 !text-sm" disabled={busy === m.id} onClick={() => toggleActive(m.id, !m.active)}>
              {m.active ? "Deactivate" : "Activate"}
            </button>
            <button type="button" className="bk-btn bk-btn-ghost !py-1.5 !px-3 !text-sm" disabled={busy === m.id} onClick={() => duplicate(m.id)}>
              Duplicate
            </button>
            <Link href={`/admin/share/${m.slug}`} className="bk-btn bk-btn-ghost !py-1.5 !px-3 !text-sm">
              Share
            </Link>
            <Link href={`/admin/event-types/${m.id}`} className="bk-btn bk-btn-ghost !py-1.5 !px-3 !text-sm">
              Edit
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
