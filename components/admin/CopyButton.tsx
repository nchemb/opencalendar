"use client";

import { useState } from "react";

/** Small copy-to-clipboard button, meant for the top-right corner of a code/URL box. */
export default function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`text-xs font-medium underline text-[var(--bk-muted)] hover:text-[var(--bk-fg)] shrink-0 ${className}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard blocked (non-https, permissions) — nothing to fall back to */
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** A titled box with the copy button pinned top-right, for any copyable snippet. */
export function CopyBox({ label, code, mono = true }: { label: string; code: string; mono?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className="text-xs font-medium text-[var(--bk-muted)]">{label}</span>
        <CopyButton text={code} />
      </div>
      <pre
        className={`bg-[var(--bk-surface-2)] border border-[var(--bk-border)] rounded-lg p-3 text-[11.5px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-all ${mono ? "font-mono" : ""}`}
      >
        {code}
      </pre>
    </div>
  );
}
