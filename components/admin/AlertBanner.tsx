"use client";

import Link from "next/link";
import { useState } from "react";
import StatusBadge, { type BadgeTone } from "./StatusBadge";

export type AdminAlert = {
  id: string;
  kind: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  bookingId: string | null;
  createdAt: string;
};

const TONE: Record<AdminAlert["severity"], BadgeTone> = { critical: "danger", warning: "warn", info: "muted" };

export default function AlertBanner({ initial }: { initial: AdminAlert[] }) {
  const [alerts, setAlerts] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  if (!alerts.length) return null;

  async function resolve(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/alerts/${id}`, { method: "POST" });
      const data = await res.json();
      if (data.ok) setAlerts((a) => a.filter((x) => x.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  const shown = expanded ? alerts : alerts.slice(0, 3);
  const worst = alerts.some((a) => a.severity === "critical") ? "danger" : "warn";

  return (
    <div className="border-b border-[var(--bk-border)]" style={{ background: `color-mix(in srgb, var(--bk-${worst === "danger" ? "danger" : "accent"}) 8%, var(--bk-bg))` }}>
      <div className="max-w-5xl mx-auto px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <StatusBadge tone={worst} label={`${alerts.length} open alert${alerts.length > 1 ? "s" : ""}`} />
          {alerts.length > 3 && (
            <button type="button" className="text-xs underline text-[var(--bk-muted)]" onClick={() => setExpanded((e) => !e)}>
              {expanded ? "show fewer" : `show all ${alerts.length}`}
            </button>
          )}
        </div>
        <div className="space-y-2">
          {shown.map((a) => (
            <div key={a.id} className="bk-card p-3 flex flex-wrap items-start gap-x-3 gap-y-1.5">
              <StatusBadge tone={TONE[a.severity]} label={a.severity} />
              <div className="min-w-[200px] flex-1">
                <p className="text-sm font-medium">{a.title}</p>
                <p className="text-xs text-[var(--bk-muted)] whitespace-pre-line mt-0.5">{a.message}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {a.bookingId && (
                  <Link href={`/admin/bookings/${a.bookingId}`} className="text-xs underline text-[var(--bk-muted)] hover:text-[var(--bk-fg)]">
                    Open booking
                  </Link>
                )}
                <button
                  type="button"
                  className="bk-btn bk-btn-ghost !py-1 !px-2.5 !text-xs"
                  disabled={busyId === a.id}
                  onClick={() => resolve(a.id)}
                >
                  {busyId === a.id ? "…" : "Resolve"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
