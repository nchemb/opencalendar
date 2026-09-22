"use client";

import { useState } from "react";

export default function RetryJobButton({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/retry`, { method: "POST" });
      const data = await res.json();
      if (data.ok) window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="bk-btn bk-btn-ghost !py-1 !px-2.5 !text-xs" onClick={retry} disabled={busy}>
      {busy ? "…" : "Retry"}
    </button>
  );
}
