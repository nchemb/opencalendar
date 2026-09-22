"use client";

import { useState } from "react";
import { DAY_LABELS, type DateOverride, type WeeklyHours } from "@/lib/types";

export type EditableSchedule = {
  id: string;
  name: string;
  timezone: string;
  weeklyHours: WeeklyHours;
  overrides: DateOverride[];
  isDefault: boolean;
};

const BLANK: EditableSchedule = {
  id: "",
  name: "New schedule",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  weeklyHours: { "1": [{ start: "09:00", end: "17:00" }], "2": [{ start: "09:00", end: "17:00" }], "3": [{ start: "09:00", end: "17:00" }], "4": [{ start: "09:00", end: "17:00" }], "5": [{ start: "09:00", end: "17:00" }] },
  overrides: [],
  isDefault: false,
};

export default function SchedulesManager({ schedules }: { schedules: EditableSchedule[] }) {
  const [editing, setEditing] = useState<EditableSchedule | null>(null);

  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="font-semibold">Schedules</h2>
        <button type="button" className="bk-btn bk-btn-primary ml-auto !py-1.5 !px-3 !text-sm" onClick={() => setEditing({ ...BLANK })}>
          New schedule
        </button>
      </div>
      <div className="space-y-2">
        {schedules.length === 0 && <p className="text-sm text-[var(--bk-muted)]">No schedules yet.</p>}
        {schedules.map((s) => (
          <div key={s.id} className="bk-card p-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="font-medium">{s.name}</span>
            <span className="text-sm text-[var(--bk-muted)]">{s.timezone}</span>
            {s.isDefault && <span className="bk-badge bk-badge-ok">default</span>}
            {s.overrides.length > 0 && <span className="bk-badge bk-badge-muted">{s.overrides.length} override{s.overrides.length > 1 ? "s" : ""}</span>}
            <button type="button" className="bk-btn bk-btn-ghost !py-1.5 !px-3 !text-sm ml-auto" onClick={() => setEditing({ ...s })}>
              Edit
            </button>
          </div>
        ))}
      </div>
      {editing && <Editor value={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function Editor({ value, onClose }: { value: EditableSchedule; onClose: () => void }) {
  const [form, setForm] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = !form.id;

  function set<K extends keyof EditableSchedule>(key: K, v: EditableSchedule[K]) {
    setForm((f) => ({ ...f, [key]: v }));
  }

  function setDay(day: number, enabled: boolean) {
    const next = { ...form.weeklyHours };
    if (enabled) next[String(day)] = [{ start: "09:00", end: "17:00" }];
    else delete next[String(day)];
    set("weeklyHours", next);
  }

  function setRange(day: number, i: number, field: "start" | "end", v: string) {
    const next = { ...form.weeklyHours };
    const ranges = [...(next[String(day)] ?? [])];
    ranges[i] = { ...ranges[i], [field]: v };
    next[String(day)] = ranges;
    set("weeklyHours", next);
  }

  function addRange(day: number) {
    const next = { ...form.weeklyHours };
    next[String(day)] = [...(next[String(day)] ?? []), { start: "18:00", end: "20:00" }];
    set("weeklyHours", next);
  }

  function removeRange(day: number, i: number) {
    const next = { ...form.weeklyHours };
    const ranges = (next[String(day)] ?? []).filter((_, j) => j !== i);
    if (ranges.length) next[String(day)] = ranges;
    else delete next[String(day)];
    set("weeklyHours", next);
  }

  function copyToDays(fromDay: number, toDays: number[]) {
    const source = form.weeklyHours[String(fromDay)] ?? [];
    const next = { ...form.weeklyHours };
    for (const d of toDays) next[String(d)] = source.map((r) => ({ ...r }));
    set("weeklyHours", next);
  }

  function addOverride() {
    set("overrides", [...form.overrides, { date: new Date().toISOString().slice(0, 10), ranges: [] }]);
  }

  function updateOverride(i: number, patch: Partial<DateOverride>) {
    set("overrides", form.overrides.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  }

  function removeOverride(i: number) {
    set("overrides", form.overrides.filter((_, j) => j !== i));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(isNew ? "/api/admin/schedules" : `/api/admin/schedules/${form.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Could not save.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this schedule? Event types using it fall back to the host default.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/schedules/${form.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Could not delete.");
        return;
      }
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 overflow-y-auto p-4 grid place-items-start sm:place-items-center">
      <div className="bk-card w-full max-w-2xl p-6 my-4 bk-fade">
        <div className="flex items-center mb-5">
          <h2 className="text-lg font-semibold">{isNew ? "New schedule" : form.name}</h2>
          <button type="button" className="ml-auto text-[var(--bk-muted)] hover:text-[var(--bk-fg)]" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-5">
          <label className="block">
            <span className="bk-label">Name</span>
            <input className="bk-input" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="block">
            <span className="bk-label">Timezone (IANA)</span>
            <input className="bk-input" value={form.timezone} onChange={(e) => set("timezone", e.target.value)} placeholder="America/Chicago" />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm mb-5">
          <input type="checkbox" checked={form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} />
          Default schedule for new event types
        </label>

        <div>
          <p className="bk-label">Weekly hours</p>
          <div className="space-y-2">
            {DAY_LABELS.map((label, day) => {
              const ranges = form.weeklyHours[String(day)] ?? [];
              const enabled = ranges.length > 0;
              return (
                <div key={day} className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 w-28 shrink-0 text-sm">
                    <input type="checkbox" checked={enabled} onChange={(e) => setDay(day, e.target.checked)} />
                    {label.slice(0, 3)}
                  </label>
                  {!enabled && <span className="text-sm text-[var(--bk-muted)]">Unavailable</span>}
                  {enabled && (
                    <div className="flex flex-col gap-2">
                      {ranges.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input type="time" className="bk-input !w-[120px] !py-1.5" value={r.start} onChange={(e) => setRange(day, i, "start", e.target.value)} />
                          <span className="text-[var(--bk-muted)]">–</span>
                          <input type="time" className="bk-input !w-[120px] !py-1.5" value={r.end} onChange={(e) => setRange(day, i, "end", e.target.value)} />
                          <button type="button" className="text-xs text-[var(--bk-muted)] hover:text-[var(--bk-fg)]" onClick={() => removeRange(day, i)}>
                            remove
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center gap-3">
                        <button type="button" className="text-xs underline text-[var(--bk-muted)] self-start" onClick={() => addRange(day)}>
                          + add range
                        </button>
                        <button
                          type="button"
                          className="text-xs underline text-[var(--bk-muted)] self-start"
                          onClick={() => copyToDays(day, [1, 2, 3, 4, 5].filter((d) => d !== day))}
                        >
                          copy to Mon–Fri
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6">
          <p className="bk-label">Date overrides</p>
          <div className="space-y-2">
            {form.overrides.map((o, i) => {
              const unavailable = o.ranges.length === 0;
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 bk-card p-2.5" style={{ background: "var(--bk-surface-2)" }}>
                  <input type="date" className="bk-input !w-[150px] !py-1.5" value={o.date} onChange={(e) => updateOverride(i, { date: e.target.value })} />
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={unavailable} onChange={(e) => updateOverride(i, { ranges: e.target.checked ? [] : [{ start: "09:00", end: "17:00" }] })} />
                    Unavailable all day
                  </label>
                  {!unavailable &&
                    o.ranges.map((r, j) => (
                      <span key={j} className="flex items-center gap-1">
                        <input
                          type="time"
                          className="bk-input !w-[110px] !py-1.5"
                          value={r.start}
                          onChange={(e) => updateOverride(i, { ranges: o.ranges.map((x, k) => (k === j ? { ...x, start: e.target.value } : x)) })}
                        />
                        <input
                          type="time"
                          className="bk-input !w-[110px] !py-1.5"
                          value={r.end}
                          onChange={(e) => updateOverride(i, { ranges: o.ranges.map((x, k) => (k === j ? { ...x, end: e.target.value } : x)) })}
                        />
                      </span>
                    ))}
                  <button type="button" className="text-xs text-[var(--bk-muted)] hover:text-[var(--bk-fg)] ml-auto" onClick={() => removeOverride(i)}>
                    remove
                  </button>
                </div>
              );
            })}
            <button type="button" className="text-xs underline text-[var(--bk-muted)]" onClick={addOverride}>
              + add date override
            </button>
          </div>
        </div>

        {error && <p className="text-sm mt-4" style={{ color: "var(--bk-danger)" }}>{error}</p>}

        <div className="flex flex-wrap gap-2.5 mt-6">
          <button type="button" className="bk-btn bk-btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : isNew ? "Create" : "Save changes"}
          </button>
          <button type="button" className="bk-btn bk-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {!isNew && (
            <button type="button" className="bk-btn bk-btn-ghost ml-auto" style={{ color: "var(--bk-danger)" }} onClick={remove} disabled={busy}>
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
