"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LOCATION_KINDS, LOCATION_LABELS, MAX_QUESTIONS, QUESTION_TYPES, type LocationKind, type LocationOption, type BookingQuestion, type QuestionType } from "@/lib/types";

export type EditableEventType = {
  id: string;
  slug: string;
  name: string;
  description: string;
  brandId: string;
  scheduleId: string;
  durationMinutes: number;
  durationOptions: { minutes: number; priceCents: number | null }[];
  priceCents: number | null;
  currency: string;
  color: string;
  windowType: "CALENDAR_DAYS" | "BUSINESS_DAYS" | "DATE_RANGE" | "INDEFINITE";
  daysInAdvance: number;
  windowStart: string;
  windowEnd: string;
  minNoticeMinutes: number;
  startIncrementMinutes: number | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  dailyLimit: number | null;
  weeklyLimit: number | null;
  locations: LocationOption[];
  questions: BookingQuestion[];
  allowGuests: boolean;
  maxGuests: number;
  redirectUrl: string;
  redirectPassParams: boolean;
  confirmationNote: string;
  cancelCutoffHours: number | null;
  refundPolicy: "before_cutoff" | "always" | "never";
  policyText: string;
  reminderMinutes: number[];
  followUpMinutes: number | null;
  secret: boolean;
  displayMode: "popup" | "inline";
  active: boolean;
};

const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  single_choice: "Single choice",
  multi_choice: "Multiple choice",
  dropdown: "Dropdown",
  phone: "Phone",
};

const LOCATION_NEEDS_VALUE: LocationKind[] = ["link", "phone_host", "in_person", "custom"];

export default function EventTypeEditor({
  value,
  isNew,
  brands,
  schedules,
  hostReady,
}: {
  value: EditableEventType;
  isNew: boolean;
  brands: { id: string; name: string }[];
  schedules: { id: string; name: string; timezone: string }[];
  hostReady: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<EditableEventType>(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof EditableEventType>(key: K, v: EditableEventType[K]) {
    setForm((f) => ({ ...f, [key]: v }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(isNew ? "/api/admin/event-types" : `/api/admin/event-types/${form.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          brandId: form.brandId || null,
          scheduleId: form.scheduleId || null,
          description: form.description || null,
          redirectUrl: form.redirectUrl || null,
          confirmationNote: form.confirmationNote || null,
          policyText: form.policyText || null,
          windowStart: form.windowStart || null,
          windowEnd: form.windowEnd || null,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Could not save.");
        return;
      }
      router.push(isNew ? `/admin/event-types/${data.id}` : "/admin/event-types");
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this event type? Types with bookings are deactivated instead.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/event-types/${form.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Could not delete.");
        return;
      }
      router.push("/admin/event-types");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bk-card p-6 space-y-8">
      <div className="flex items-center">
        <h1 className="text-xl font-semibold">{isNew ? "New event type" : form.name}</h1>
      </div>

      {!hostReady && (
        <p className="text-sm" style={{ color: "var(--bk-danger)" }}>
          Connect Google Calendar in Settings first.
        </p>
      )}

      <Section title="Basics">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Name">
            <input className="bk-input" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Slug (URL)">
            <input className="bk-input" value={form.slug} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description (markdown)">
              <textarea className="bk-input min-h-[76px] resize-y" value={form.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
          </div>
          <Field label="Brand">
            <select className="bk-input" value={form.brandId} onChange={(e) => set("brandId", e.target.value)}>
              <option value="">None</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Schedule">
            <select className="bk-input" value={form.scheduleId} onChange={(e) => set("scheduleId", e.target.value)}>
              <option value="">Host default</option>
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.timezone})</option>
              ))}
            </select>
          </Field>
          <Field label="Accent color">
            <div className="flex gap-2">
              <input className="bk-input flex-1" value={form.color} onChange={(e) => set("color", e.target.value)} />
              <input type="color" className="w-11 h-[42px] rounded-lg border border-[var(--bk-border)] bg-transparent" value={form.color} onChange={(e) => set("color", e.target.value)} />
            </div>
          </Field>
          <Field label="Embed mode">
            <select className="bk-input" value={form.displayMode} onChange={(e) => set("displayMode", e.target.value as "popup" | "inline")}>
              <option value="popup">Popup</option>
              <option value="inline">Inline</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Duration and price">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Default duration (minutes)">
            <input type="number" className="bk-input" min={5} max={720} value={form.durationMinutes} onChange={(e) => set("durationMinutes", Number(e.target.value))} />
          </Field>
          <Field label="Price in dollars (blank = free)">
            <input
              type="number"
              className="bk-input"
              min={0}
              step="1"
              value={form.priceCents === null ? "" : form.priceCents / 100}
              onChange={(e) => set("priceCents", e.target.value === "" ? null : Math.round(Number(e.target.value) * 100))}
            />
          </Field>
          <Field label="Currency">
            <input className="bk-input" value={form.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toLowerCase())} />
          </Field>
        </div>
        <div className="mt-3">
          <p className="bk-label">Extra durations the invitee can pick (optional)</p>
          <div className="space-y-2">
            {form.durationOptions.map((d, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  className="bk-input !w-28"
                  placeholder="minutes"
                  value={d.minutes}
                  onChange={(e) => set("durationOptions", form.durationOptions.map((x, j) => (j === i ? { ...x, minutes: Number(e.target.value) } : x)))}
                />
                <input
                  type="number"
                  className="bk-input !w-28"
                  placeholder="price $"
                  value={d.priceCents === null ? "" : d.priceCents / 100}
                  onChange={(e) =>
                    set(
                      "durationOptions",
                      form.durationOptions.map((x, j) => (j === i ? { ...x, priceCents: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) } : x))
                    )
                  }
                />
                <button type="button" className="text-xs text-[var(--bk-muted)] hover:text-[var(--bk-fg)]" onClick={() => set("durationOptions", form.durationOptions.filter((_, j) => j !== i))}>
                  remove
                </button>
              </div>
            ))}
            <button type="button" className="text-xs underline text-[var(--bk-muted)]" onClick={() => set("durationOptions", [...form.durationOptions, { minutes: 60, priceCents: null }])}>
              + add duration option
            </button>
          </div>
        </div>
      </Section>

      <Section title="Scheduling window">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Window type">
            <select className="bk-input" value={form.windowType} onChange={(e) => set("windowType", e.target.value as EditableEventType["windowType"])}>
              <option value="CALENDAR_DAYS">Rolling calendar days</option>
              <option value="BUSINESS_DAYS">Rolling business days (Mon–Fri)</option>
              <option value="DATE_RANGE">Fixed date range</option>
              <option value="INDEFINITE">Indefinite</option>
            </select>
          </Field>
          {(form.windowType === "CALENDAR_DAYS" || form.windowType === "BUSINESS_DAYS") && (
            <Field label={form.windowType === "BUSINESS_DAYS" ? "Business days ahead" : "Calendar days ahead"}>
              <input type="number" className="bk-input" min={0} max={365} value={form.daysInAdvance} onChange={(e) => set("daysInAdvance", Number(e.target.value))} />
            </Field>
          )}
          {form.windowType === "DATE_RANGE" && (
            <>
              <Field label="Start date">
                <input type="date" className="bk-input" value={form.windowStart} onChange={(e) => set("windowStart", e.target.value)} />
              </Field>
              <Field label="End date">
                <input type="date" className="bk-input" value={form.windowEnd} onChange={(e) => set("windowEnd", e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Minimum notice (minutes)">
            <input type="number" className="bk-input" min={0} value={form.minNoticeMinutes} onChange={(e) => set("minNoticeMinutes", Number(e.target.value))} />
          </Field>
          <Field label="Start-time increment (blank = duration)">
            <input
              type="number"
              className="bk-input"
              min={5}
              max={480}
              value={form.startIncrementMinutes ?? ""}
              onChange={(e) => set("startIncrementMinutes", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>
          <Field label="Buffer before (minutes)">
            <input type="number" className="bk-input" min={0} max={480} value={form.bufferBeforeMinutes} onChange={(e) => set("bufferBeforeMinutes", Number(e.target.value))} />
          </Field>
          <Field label="Buffer after (minutes)">
            <input type="number" className="bk-input" min={0} max={480} value={form.bufferAfterMinutes} onChange={(e) => set("bufferAfterMinutes", Number(e.target.value))} />
          </Field>
          <Field label="Max bookings per day (blank = no limit)">
            <input type="number" className="bk-input" min={1} value={form.dailyLimit ?? ""} onChange={(e) => set("dailyLimit", e.target.value === "" ? null : Number(e.target.value))} />
          </Field>
          <Field label="Max bookings per week (blank = no limit)">
            <input type="number" className="bk-input" min={1} value={form.weeklyLimit ?? ""} onChange={(e) => set("weeklyLimit", e.target.value === "" ? null : Number(e.target.value))} />
          </Field>
        </div>
      </Section>

      <Section title="Locations">
        <div className="space-y-2">
          {form.locations.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                className="bk-input !w-auto"
                value={l.kind}
                onChange={(e) => set("locations", form.locations.map((x, j) => (j === i ? { kind: e.target.value as LocationKind, value: x.value, label: x.label } : x)))}
              >
                {LOCATION_KINDS.map((k) => (
                  <option key={k} value={k}>{LOCATION_LABELS[k]}</option>
                ))}
              </select>
              {LOCATION_NEEDS_VALUE.includes(l.kind) && (
                <input
                  className="bk-input flex-1 min-w-[180px]"
                  placeholder={l.kind === "in_person" ? "Address" : l.kind === "phone_host" ? "Phone number" : "URL"}
                  value={l.value ?? ""}
                  onChange={(e) => set("locations", form.locations.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                />
              )}
              <button type="button" className="text-xs text-[var(--bk-muted)] hover:text-[var(--bk-fg)]" onClick={() => set("locations", form.locations.filter((_, j) => j !== i))}>
                remove
              </button>
            </div>
          ))}
          {form.locations.length < 6 && (
            <button type="button" className="text-xs underline text-[var(--bk-muted)]" onClick={() => set("locations", [...form.locations, { kind: "google_meet" }])}>
              + add location
            </button>
          )}
        </div>
      </Section>

      <Section title="Invitee questions">
        <div className="space-y-3">
          {form.questions.map((q, i) => (
            <div key={i} className="bk-card p-3 space-y-2" style={{ background: "var(--bk-surface-2)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="bk-input flex-1 min-w-[180px]"
                  value={q.label}
                  maxLength={200}
                  placeholder="Question"
                  onChange={(e) => set("questions", form.questions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                <select
                  className="bk-input !w-auto"
                  value={q.type}
                  onChange={(e) => set("questions", form.questions.map((x, j) => (j === i ? { ...x, type: e.target.value as QuestionType } : x)))}
                >
                  {QUESTION_TYPES.map((t) => (
                    <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-sm text-[var(--bk-muted)]">
                  <input type="checkbox" checked={q.required} onChange={(e) => set("questions", form.questions.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />
                  required
                </label>
                <button type="button" className="text-xs text-[var(--bk-muted)] hover:text-[var(--bk-fg)] ml-auto" onClick={() => set("questions", form.questions.filter((_, j) => j !== i))}>
                  remove
                </button>
              </div>
              {(q.type === "single_choice" || q.type === "multi_choice" || q.type === "dropdown") && (
                <input
                  className="bk-input"
                  placeholder="Options, comma separated"
                  value={(q.options ?? []).join(", ")}
                  onChange={(e) =>
                    set(
                      "questions",
                      form.questions.map((x, j) => (j === i ? { ...x, options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) } : x))
                    )
                  }
                />
              )}
            </div>
          ))}
          {form.questions.length < MAX_QUESTIONS && (
            <button
              type="button"
              className="text-xs underline text-[var(--bk-muted)]"
              onClick={() => set("questions", [...form.questions, { id: `q${form.questions.length + 1}`, label: "", type: "long_text", required: false }])}
            >
              + add question
            </button>
          )}
        </div>
      </Section>

      <Section title="Guests">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.allowGuests} onChange={(e) => set("allowGuests", e.target.checked)} />
            Allow guests
          </label>
          {form.allowGuests && (
            <Field label="Max guests">
              <input type="number" className="bk-input !w-24" min={0} max={25} value={form.maxGuests} onChange={(e) => set("maxGuests", Number(e.target.value))} />
            </Field>
          )}
        </div>
      </Section>

      <Section title="After booking">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Redirect URL (blank = built-in confirmation page)">
            <input className="bk-input" value={form.redirectUrl} onChange={(e) => set("redirectUrl", e.target.value)} placeholder="https://example.com/thanks" />
          </Field>
          <label className="flex items-center gap-2 text-sm self-end pb-2.5">
            <input type="checkbox" checked={form.redirectPassParams} onChange={(e) => set("redirectPassParams", e.target.checked)} />
            Pass booking details as query params
          </label>
          <div className="sm:col-span-2">
            <Field label="Confirmation note">
              <textarea className="bk-input min-h-[70px]" value={form.confirmationNote} onChange={(e) => set("confirmationNote", e.target.value)} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Cancel and reschedule policy">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Invitee cutoff, hours before start (blank = any time)">
            <input type="number" className="bk-input" min={0} value={form.cancelCutoffHours ?? ""} onChange={(e) => set("cancelCutoffHours", e.target.value === "" ? null : Number(e.target.value))} />
          </Field>
          <Field label="Refund on invitee cancel">
            <select className="bk-input" value={form.refundPolicy} onChange={(e) => set("refundPolicy", e.target.value as EditableEventType["refundPolicy"])}>
              <option value="before_cutoff">Full refund before cutoff, none after</option>
              <option value="always">Always full refund</option>
              <option value="never">Never refund</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Policy text shown before paying">
              <textarea className="bk-input min-h-[60px]" value={form.policyText} onChange={(e) => set("policyText", e.target.value)} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Reminders">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {form.reminderMinutes.map((m, i) => (
              <span key={i} className="bk-badge bk-badge-muted">
                {m >= 1440 ? `${m / 1440}d` : m >= 60 ? `${m / 60}h` : `${m}m`} before
                <button type="button" className="ml-1.5" onClick={() => set("reminderMinutes", form.reminderMinutes.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <AddReminder onAdd={(m) => set("reminderMinutes", [...new Set([...form.reminderMinutes, m])].sort((a, b) => b - a))} />
          <Field label="Follow-up email, minutes after end (blank = off)">
            <input type="number" className="bk-input !w-40" min={5} value={form.followUpMinutes ?? ""} onChange={(e) => set("followUpMinutes", e.target.value === "" ? null : Number(e.target.value))} />
          </Field>
        </div>
      </Section>

      <div className="flex flex-wrap gap-5 pt-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
          Active (bookable)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.secret} onChange={(e) => set("secret", e.target.checked)} />
          Secret (hidden from brand profile page, bookable by URL)
        </label>
      </div>

      {error && <p className="text-sm" style={{ color: "var(--bk-danger)" }}>{error}</p>}

      <div className="flex flex-wrap gap-2.5">
        <button type="button" className="bk-btn bk-btn-primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : isNew ? "Create" : "Save changes"}
        </button>
        <button type="button" className="bk-btn bk-btn-ghost" onClick={() => router.push("/admin/event-types")}>
          Cancel
        </button>
        {!isNew && (
          <button type="button" className="bk-btn bk-btn-ghost ml-auto" style={{ color: "var(--bk-danger)" }} onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function AddReminder({ onAdd }: { onAdd: (minutes: number) => void }) {
  const [v, setV] = useState("60");
  return (
    <div className="flex items-center gap-2">
      <input type="number" className="bk-input !w-28" min={1} value={v} onChange={(e) => setV(e.target.value)} />
      <span className="text-sm text-[var(--bk-muted)]">minutes before</span>
      <button type="button" className="text-xs underline text-[var(--bk-muted)]" onClick={() => { const n = Number(v); if (n > 0) onAdd(n); }}>
        + add reminder
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-6 border-t border-[var(--bk-border)] first:pt-0 first:border-t-0">
      <h2 className="font-semibold mb-3 text-sm text-[var(--bk-muted)] uppercase tracking-wide">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="bk-label">{label}</span>
      {children}
    </label>
  );
}
