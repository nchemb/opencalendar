"use client";

import { useState } from "react";

type Props = {
  baseUrl: string;
  slug: string;
  color: string;
  displayMode: "popup" | "inline";
};

function CopyBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-[var(--bk-muted)]">{label}</span>
        <button
          type="button"
          className="text-xs underline text-[var(--bk-muted)] hover:text-[var(--bk-fg)]"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            } catch {
              /* clipboard blocked */
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="bg-[var(--bk-surface-2)] border border-[var(--bk-border)] rounded-lg p-3 text-[11.5px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-all">
        {code}
      </pre>
    </div>
  );
}

export default function SharePanel({ baseUrl, slug, color, displayMode }: Props) {
  const link = `${baseUrl}/${slug}`;
  const scriptTag = `<script src="${baseUrl}/widget.js" defer></script>`;
  const hex = color.replace("#", "");

  const popupCode = `${scriptTag}
<button data-bookkit-popup="${slug}" data-primary-color="${color}">Book a call</button>`;

  const inlineCode = `${scriptTag}
<div data-bookkit="${slug}" data-theme="dark" data-primary-color="${color}"></div>`;

  const iframeCode = `<iframe
  src="${baseUrl}/embed/${slug}?theme=dark&primaryColor=${hex}"
  style="width:100%;min-height:640px;border:0"
  title="Book a time"
></iframe>`;

  const order =
    displayMode === "inline"
      ? [
          { label: "Inline (default for this type)", code: inlineCode },
          { label: "Popup button", code: popupCode },
        ]
      : [
          { label: "Popup button (default for this type)", code: popupCode },
          { label: "Inline calendar", code: inlineCode },
        ];

  return (
    <div className="space-y-4">
      <CopyBlock label="Direct link" code={link} />
      {order.map((o) => (
        <CopyBlock key={o.label} label={o.label} code={o.code} />
      ))}
      <CopyBlock label="Plain iframe (no script)" code={iframeCode} />
      <p className="text-xs text-[var(--bk-muted)]">
        Both modes work for every meeting type — the display mode only decides which snippet is
        suggested first. The widget emits <code>bookkit.time_selected</code>,{" "}
        <code>bookkit.booked</code> and <code>bookkit.checkout</code> events on{" "}
        <code>window</code> for conversion tracking.
      </p>
    </div>
  );
}
