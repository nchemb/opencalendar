"use client";

import { useState } from "react";
import { DAY_LABELS, DEFAULT_WEEKLY_HOURS, MAX_QUESTIONS, type BookingQuestion, type WeeklyHours } from "@/lib/types";
import SharePanel from "./SharePanel";

export type EditableMeetingType = {
  id: string;
  slug: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number | null;
  currency: string;
  color: string;
  weeklyHours: WeeklyHours;
  daysInAdvance: number;
  minNoticeHours: number;
  bufferMinutes: number;
  dailyLimit: number | null;
  questions: BookingQuestion[];
  redirectUrl: string;
  displayMode: "popup" | "inline";
  active: boolean;
};

const BLANK: EditableMeetingType = {
  id: "",
  slug: "",
  name: "",
  description: "",
  durationMinutes: 30,
  priceCents: null,
  currency: "usd",
  color: "#FF6A00",
  weeklyHours: DEFAULT_WEEKLY_HOURS,
  daysInAdvance: 30,
  minNoticeHours: 12,
  bufferMinutes: 0,
  dailyLimit: null,
  questions: [],
  redirectUrl: "",
  displayMode: "popup",
  active: true,
};

export default function MeetingTypeManager({
  meetingTypes,
  baseUrl,
  hostReady,
  hostTimezone,
}: {
  meetingTypes: EditableMeetingType[];
  baseUrl: string;
  hostReady: boolean;
  hostTimezone: string;
}) {
  const [editing, setEditing] = useState<EditableMeetingType | null>(null);
  const [sharing, setSharing] = useState<EditableMeetingType | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Meeting types</h1>
          <p className="text-[var(--bk-muted)] text-sm">
            Weekly hours are in your host timezone ({hostTimezone}).
          </p>
        </div>
        <button
          type="button"
          className="bk-btn bk-btn-primary ml-auto"
          disabled={!hostReady}
          onClick={() => setEditing({ ...BLANK })}
        >
          New meeting type
        </button>
      </div>

      {!hostReady && (
        <p className="text-sm" style={{ color: "var(--bk-danger)" }}>
          Connect Google Calendar in Settings before creating meeting types.
        </p>
      )}

      <div className="space-y-3">
        {meetingTypes.length === 0 && (
          <p className="text-[var(--bk-muted)] text-sm">No meeting types yet.</p>
        )}
        {meetingTypes.map((m) => (
          <div key={m.id} className="bk-card p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: m.color }} />
              <span className="font-medium">{m.name}</span>
              <code className="text-xs text-[var(--bk-muted)]">/{m.slug}</code>
              <span className="text-sm text-[var(--bk-muted)]">{m.durationMinutes} min</span>
              <span className="text-sm text-[var(--bk-muted)]">
                {m.priceCents ? `$${(m.priceCents / 100).toFixed(0)}` : "Free"}
              </span>
              <span className="text-xs rounded-full px-2 py-0.5 border border-[var(--bk-border)] text-[var(--bk-muted)]">
                {m.displayMode}
              </span>
              {!m.active && (
                <span className="text-xs font-semibold" style={{ color: "var(--bk-danger)" }}>
                  inactive
                </span>
              )}
              <div className="ml-auto flex gap-2">
                <a className="bk-btn bk-btn-ghost !py-1.5 !px-3 !text-sm" href={`/${m.slug}`} target="_blank" rel="noreferrer">
                  Preview
                </a>
                <button
                  type="button"
                  className="bk-btn bk-btn-ghost !py-1.5 !px-3 !text-sm"
                  onClick={() => setSharing(sharing?.id === m.id ? null : m)}
                >
                  Share
                </button>
                <button
                  type="button"
                  className="bk-btn bk-btn-ghost !py-1.5 !px-3 !text-sm"
                  onClick={() => setEditing({ ...m })}
                >
                  Edit
                </button>
              </div>
            </div>

            {sharing?.id === m.id && (
              <div className="mt-4 pt-4 border-t border-[var(--bk-border)]">
                <SharePanel baseUrl={baseUrl} slug={m.slug} color={m.color} displayMode={m.displayMode} />
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && <Editor value={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Editor({ value, onClose }: { value: EditableMeetingType; onClose: () => void }) {
  const [form, setForm] = useState<EditableMeetingType>(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = !form.id;

  function set<K extends keyof EditableMeetingType>(key: K, v: EditableMeetingType[K]) {
    setForm((f) => ({ ...f, [key]: v }));
  }

  function setDay(day: number, enabled: boolean) {
    setForm((f) => {
      const next = { ...f.weeklyHours };
      if (enabled) next[String(day)] = [{ start: "09:00", end: "17:00" }];
      else delete next[String(day)];
      return { ...f, weeklyHours: next };
    });
  }

  function setRange(day: number, index: number, field: "start" | "end", v: string) {
    setForm((f) => {
      const next = { ...f.weeklyHours };
      const ranges = [...(next[String(day)] ?? [])];
      ranges[index] = { ...ranges[index], [field]: v };
      next[String(day)] = ranges;
      return { ...f, weeklyHours: next };
    });
  }

  function addRange(day: number) {
    setForm((f) => {
      const next = { ...f.weeklyHours };
      next[String(day)] = [...(next[String(day)] ?? []), { start: "18:00", end: "20:00" }];
      return { ...f, weeklyHours: next };
    });
  }

  function removeRange(day: number, index: number) {
    setForm((f) => {
      const next = { ...f.weeklyHours };
      const ranges = (next[String(day)] ?? []).filter((_, i) => i !== index);
      if (ranges.length) next[String(day)] = ranges;
      else delete next[String(day)];
      return { ...f, weeklyHours: next };
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        isNew ? "/api/admin/meeting-types" : `/api/admin/meeting-types/${form.id}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            description: form.description || null,
            redirectUrl: form.redirectUrl || null,
          }),
        }
      );
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
    if (!confirm("Delete this meeting type? Types with bookings are deactivated instead.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/meeting-types/${form.id}`, { method: "DELETE" });
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
          <h2 className="text-lg font-semibold">{isNew ? "New meeting type" : form.name}</h2>
          <button type="button" className="ml-auto text-[var(--bk-muted)] hover:text-[var(--bk-fg)]" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Name">
            <input className="bk-input" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Slug (URL)">
            <input
              className="bk-input"
              value={form.slug}
              onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Description">
              <textarea
                className="bk-input min-h-[76px] resize-y"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
          </div>

          <Field label="Duration (minutes)">
            <input
              className="bk-input"
              type="number"
              min={5}
              max={480}
              value={form.durationMinutes}
              onChange={(e) => set("durationMinutes", Number(e.target.value))}
            />
          </Field>
          <Field label="Price in dollars (blank = free)">
            <input
              className="bk-input"
              type="number"
              min={0}
              step="1"
              value={form.priceCents === null ? "" : form.priceCents / 100}
              onChange={(e) =>
                set("priceCents", e.target.value === "" ? null : Math.round(Number(e.target.value) * 100))
              }
            />
          </Field>

          <Field label="Accent color">
            <div className="flex gap-2">
              <input
                className="bk-input flex-1"
                value={form.color}
                onChange={(e) => set("color", e.target.value)}
              />
              <input
                type="color"
                className="w-11 h-[42px] rounded-lg border border-[var(--bk-border)] bg-transparent"
                value={form.color}
                onChange={(e) => set("color", e.target.value)}
              />
            </div>
          </Field>
          <Field label="Default embed mode">
            <select
              className="bk-input"
              value={form.displayMode}
              onChange={(e) => set("displayMode", e.target.value as "popup" | "inline")}
            >
              <option value="popup">Popup</option>
              <option value="inline">Inline</option>
            </select>
          </Field>

          <Field label="Bookable days ahead">
            <input
              className="bk-input"
              type="number"
              min={1}
              max={365}
              value={form.daysInAdvance}
              onChange={(e) => set("daysInAdvance", Number(e.target.value))}
            />
          </Field>
          <Field label="Minimum notice (hours)">
            <input
              className="bk-input"
              type="number"
              min={0}
              max={720}
              value={form.minNoticeHours}
              onChange={(e) => set("minNoticeHours", Number(e.target.value))}
            />
          </Field>

          <Field label="Buffer between meetings (minutes)">
            <input
              className="bk-input"
              type="number"
              min={0}
              max={240}
              value={form.bufferMinutes}
              onChange={(e) => set("bufferMinutes", Number(e.target.value))}
            />
          </Field>
          <Field label="Max bookings per day (blank = no limit)">
            <input
              className="bk-input"
              type="number"
              min={1}
              max={50}
              value={form.dailyLimit ?? ""}
              onChange={(e) => set("dailyLimit", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>

          <div className="sm:col-span-2">
            <p className="bk-label">Booking form questions (asked after name + email)</p>
            <div className="space-y-2">
              {form.questions.map((q, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    className="bk-input flex-1 min-w-[220px]"
                    value={q.label}
                    maxLength={200}
                    placeholder="What do you want to get out of this call?"
                    onChange={(e) =>
                      set(
                        "questions",
                        form.questions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))
                      )
                    }
                  />
                  <label className="flex items-center gap-1.5 text-sm text-[var(--bk-muted)]">
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={(e) =>
                        set(
                          "questions",
                          form.questions.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x))
                        )
                      }
                    />
                    required
                  </label>
                  <button
                    type="button"
                    className="text-xs text-[var(--bk-muted)] hover:text-[var(--bk-fg)]"
                    onClick={() => set("questions", form.questions.filter((_, j) => j !== i))}
                  >
                    remove
                  </button>
                </div>
              ))}
              {form.questions.length < MAX_QUESTIONS && (
                <button
                  type="button"
                  className="text-xs underline text-[var(--bk-muted)]"
                  onClick={() => set("questions", [...form.questions, { label: "", required: false }])}
                >
                  + add question
                </button>
              )}
            </div>
          </div>
          <Field label="Redirect after booking (optional)">
            <input
              className="bk-input"
              value={form.redirectUrl}
              onChange={(e) => set("redirectUrl", e.target.value)}
              placeholder="https://example.com/thanks"
            />
          </Field>
        </div>

        <div className="mt-6">
          <p className="bk-label">Weekly hours</p>
          <div className="space-y-2">
            {DAY_LABELS.map((label, day) => {
              const ranges = form.weeklyHours[String(day)] ?? [];
              const enabled = ranges.length > 0;
              return (
                <div key={day} className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 w-28 shrink-0 text-sm">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setDay(day, e.target.checked)}
                    />
                    {label.slice(0, 3)}
                  </label>
                  {!enabled && <span className="text-sm text-[var(--bk-muted)]">Unavailable</span>}
                  {enabled && (
                    <div className="flex flex-col gap-2">
                      {ranges.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="time"
                            className="bk-input !w-[120px] !py-1.5"
                            value={r.start}
                            onChange={(e) => setRange(day, i, "start", e.target.value)}
                          />
                          <span className="text-[var(--bk-muted)]">–</span>
                          <input
                            type="time"
                            className="bk-input !w-[120px] !py-1.5"
                            value={r.end}
                            onChange={(e) => setRange(day, i, "end", e.target.value)}
                          />
                          <button
                            type="button"
                            className="text-xs text-[var(--bk-muted)] hover:text-[var(--bk-fg)]"
                            onClick={() => removeRange(day, i)}
                          >
                            remove
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="text-xs underline text-[var(--bk-muted)] self-start"
                        onClick={() => addRange(day)}
                      >
                        + add range
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <label className="flex items-center gap-2 mt-5 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
          Active (visible and bookable)
        </label>

        {error && <p className="text-sm mt-4" style={{ color: "var(--bk-danger)" }}>{error}</p>}

        <div className="flex flex-wrap gap-2.5 mt-6">
          <button type="button" className="bk-btn bk-btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : isNew ? "Create" : "Save changes"}
          </button>
          <button type="button" className="bk-btn bk-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {!isNew && (
            <button
              type="button"
              className="bk-btn bk-btn-ghost ml-auto"
              style={{ color: "var(--bk-danger)" }}
              onClick={remove}
              disabled={busy}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The control is nested inside the label so the two are genuinely associated —
 * a bare <label> sitting next to an input announces nothing to a screen reader
 * and cannot be clicked to focus the field.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="bk-label">{label}</span>
      {children}
    </label>
  );
}
