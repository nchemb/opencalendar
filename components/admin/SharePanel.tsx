"use client";

import { useMemo, useState } from "react";
import { CopyBox } from "./CopyButton";

type Props = {
  baseUrl: string;
  slug: string;
  color: string;
  displayMode: "popup" | "inline";
  brandSlug?: string | null;
};

export default function SharePanel({ baseUrl, slug, color, displayMode, brandSlug }: Props) {
  const [utmSource, setUtmSource] = useState("");
  const [utmMedium, setUtmMedium] = useState("");
  const [utmCampaign, setUtmCampaign] = useState("");

  const link = useMemo(() => {
    const params = new URLSearchParams();
    if (utmSource) params.set("utm_source", utmSource);
    if (utmMedium) params.set("utm_medium", utmMedium);
    if (utmCampaign) params.set("utm_campaign", utmCampaign);
    const qs = params.toString();
    return `${baseUrl}/${slug}${qs ? `?${qs}` : ""}`;
  }, [baseUrl, slug, utmSource, utmMedium, utmCampaign]);

  const scriptTag = `<script src="${baseUrl}/embed.js" defer></script>`;
  const popupCode = `${scriptTag}\n<button data-bookkit-popup="${slug}">Book a call</button>`;
  const inlineCode = `${scriptTag}\n<div data-bookkit-inline="${slug}"></div>`;
  const badgeCode = `${scriptTag}\n<script>\n  window.addEventListener("DOMContentLoaded", function () {\n    BookKit.badge({ slug: "${slug}", text: "Book a call", color: "${color}" });\n  });\n</script>`;
  const iframeCode = `<iframe src="${baseUrl}/embed/${slug}" style="width:100%;min-height:640px;border:0" title="Book a time"></iframe>`;
  const reactCode = `import { BookKitButton } from "./BookKit"; // copy from integrations/react/BookKit.tsx\n\n<BookKitButton slug="${slug}">Book a call</BookKitButton>`;
  const calendlyMapCode = `<script>\n  window.BOOKKIT_CALENDLY_MAP = { "https://calendly.com/you/${slug}": "${slug}" };\n</script>\n${scriptTag}`;
  const linkInBio = brandSlug ? `${baseUrl}/u/${brandSlug}` : `${baseUrl}/${slug}`;
  const emailSignature = `<a href="${link}" style="color:${color};font-weight:600;text-decoration:none">Book time with me</a>`;

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
    <div className="space-y-5">
      <div>
        <p className="bk-label">UTM builder</p>
        <div className="grid sm:grid-cols-3 gap-2">
          <input className="bk-input !py-2 !text-sm" placeholder="utm_source" value={utmSource} onChange={(e) => setUtmSource(e.target.value)} />
          <input className="bk-input !py-2 !text-sm" placeholder="utm_medium" value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} />
          <input className="bk-input !py-2 !text-sm" placeholder="utm_campaign" value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} />
        </div>
      </div>

      <CopyBox label="Direct link" code={link} />
      {order.map((o) => (
        <CopyBox key={o.label} label={o.label} code={o.code} />
      ))}
      <CopyBox label="Floating badge button" code={badgeCode} />
      <CopyBox label="Plain iframe (no script)" code={iframeCode} />
      <CopyBox label="React component" code={reactCode} mono />
      <CopyBox label="Calendly drop-in (swap one script tag on a page using Calendly)" code={calendlyMapCode} />
      <CopyBox label="Link-in-bio URL" code={linkInBio} />
      <CopyBox label="Email signature HTML" code={emailSignature} />

      <div>
        <p className="bk-label">QR code</p>
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/admin/qr?url=${encodeURIComponent(link)}&format=png`} alt="QR code" width={96} height={96} className="rounded-lg border border-[var(--bk-border)] bg-white" />
          <div className="flex flex-col gap-1.5 text-sm">
            <a className="underline text-[var(--bk-muted)] hover:text-[var(--bk-fg)]" href={`/api/admin/qr?url=${encodeURIComponent(link)}&format=png`} download={`bookkit-${slug}.png`}>
              Download PNG
            </a>
            <a className="underline text-[var(--bk-muted)] hover:text-[var(--bk-fg)]" href={`/api/admin/qr?url=${encodeURIComponent(link)}&format=svg`} download={`bookkit-${slug}.svg`}>
              Download SVG
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
