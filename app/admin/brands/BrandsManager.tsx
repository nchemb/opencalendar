"use client";

import { useState } from "react";

export type EditableBrand = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  logoUrl: string;
  accentColor: string;
  theme: "auto" | "light" | "dark";
  websiteUrl: string;
  replyTo: string;
  showPoweredBy: boolean;
};

const BLANK: EditableBrand = {
  id: "",
  slug: "",
  name: "",
  tagline: "",
  logoUrl: "",
  accentColor: "#FF6A00",
  theme: "auto",
  websiteUrl: "",
  replyTo: "",
  showPoweredBy: true,
};

export default function BrandsManager({ brands, baseUrl }: { brands: EditableBrand[]; baseUrl: string }) {
  const [editing, setEditing] = useState<EditableBrand | null>(null);

  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <button type="button" className="bk-btn bk-btn-primary ml-auto !py-1.5 !px-3 !text-sm" onClick={() => setEditing({ ...BLANK })}>
          New brand
        </button>
      </div>
      <div className="space-y-2">
        {brands.length === 0 && <p className="text-sm text-[var(--bk-muted)]">No brands yet.</p>}
        {brands.map((b) => (
          <div key={b.id} className="bk-card p-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: b.accentColor }} />
            <span className="font-medium">{b.name}</span>
            <a href={`/u/${b.slug}`} target="_blank" rel="noreferrer" className="text-sm underline text-[var(--bk-muted)]">
              {baseUrl}/u/{b.slug}
            </a>
            <div className="ml-auto flex gap-2">
              <button type="button" className="bk-btn bk-btn-ghost !py-1.5 !px-3 !text-sm" onClick={() => setEditing({ ...b })}>
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>
      {editing && <Editor value={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function Editor({ value, onClose }: { value: EditableBrand; onClose: () => void }) {
  const [form, setForm] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = !form.id;

  function set<K extends keyof EditableBrand>(key: K, v: EditableBrand[K]) {
    setForm((f) => ({ ...f, [key]: v }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(isNew ? "/api/admin/brands" : `/api/admin/brands/${form.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, tagline: form.tagline || null, logoUrl: form.logoUrl || null, websiteUrl: form.websiteUrl || null, replyTo: form.replyTo || null }),
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
    if (!confirm("Delete this brand? Its event types keep working but show no branding.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/brands/${form.id}`, { method: "DELETE" });
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
      <div className="bk-card w-full max-w-lg p-6 my-4 bk-fade">
        <div className="flex items-center mb-5">
          <h2 className="text-lg font-semibold">{isNew ? "New brand" : form.name}</h2>
          <button type="button" className="ml-auto text-[var(--bk-muted)] hover:text-[var(--bk-fg)]" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="bk-label">Name</span>
            <input className="bk-input" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="block">
            <span className="bk-label">Slug (/u/&lt;slug&gt;)</span>
            <input className="bk-input" value={form.slug} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} />
          </label>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="bk-label">Tagline</span>
              <input className="bk-input" value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="bk-label">Logo URL</span>
              <input className="bk-input" value={form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://..." />
            </label>
          </div>
          <label className="block">
            <span className="bk-label">Accent color</span>
            <div className="flex gap-2">
              <input className="bk-input flex-1" value={form.accentColor} onChange={(e) => set("accentColor", e.target.value)} />
              <input type="color" className="w-11 h-[42px] rounded-lg border border-[var(--bk-border)] bg-transparent" value={form.accentColor} onChange={(e) => set("accentColor", e.target.value)} />
            </div>
          </label>
          <label className="block">
            <span className="bk-label">Theme</span>
            <select className="bk-input" value={form.theme} onChange={(e) => set("theme", e.target.value as EditableBrand["theme"])}>
              <option value="auto">Auto</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="block">
            <span className="bk-label">Website URL</span>
            <input className="bk-input" value={form.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} />
          </label>
          <label className="block">
            <span className="bk-label">Reply-to email</span>
            <input className="bk-input" value={form.replyTo} onChange={(e) => set("replyTo", e.target.value)} />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm mt-5">
          <input type="checkbox" checked={form.showPoweredBy} onChange={(e) => set("showPoweredBy", e.target.checked)} />
          Show &ldquo;Powered by OpenCalendar&rdquo;
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
            <button type="button" className="bk-btn bk-btn-ghost ml-auto" style={{ color: "var(--bk-danger)" }} onClick={remove} disabled={busy}>
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
