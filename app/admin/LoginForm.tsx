"use client";

import { useState } from "react";

export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Login failed.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="bk-card p-7 w-full max-w-sm">
      <h1 className="text-lg font-semibold mb-1">BookKit admin</h1>
      <p className="text-[var(--bk-muted)] text-sm mb-5">Enter your admin password.</p>

      <label className="bk-label" htmlFor="pw">Password</label>
      <input
        id="pw"
        type="password"
        className="bk-input"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
        autoComplete="current-password"
      />

      {error && <p className="text-sm mt-3" style={{ color: "var(--bk-danger)" }}>{error}</p>}

      <button type="submit" className="bk-btn bk-btn-primary w-full mt-5" disabled={busy}>
        {busy ? "Checking…" : "Log in"}
      </button>
    </form>
  );
}
