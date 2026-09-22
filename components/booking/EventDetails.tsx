"use client";

import { useState } from "react";
import Image from "next/image";
import { renderDescription } from "@/lib/ui/markdown";
import { money } from "@/lib/ui/format";
import { locationLabel, type DurationOption, type PublicMeetingType } from "@/lib/types";

type Props = {
  meetingType: PublicMeetingType;
  selectedDuration: DurationOption;
  onDurationChange: (minutes: number) => void;
};

function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function LocationIcon({ kind }: { kind: string }) {
  const common = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, "aria-hidden": true };
  if (kind === "phone_invitee" || kind === "phone_host") {
    return (
      <svg {...common}>
        <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z" />
      </svg>
    );
  }
  if (kind === "in_person") {
    return (
      <svg {...common}>
        <path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" />
        <circle cx="12" cy="9" r="2.5" />
      </svg>
    );
  }
  if (kind === "custom") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="m16 10 6-3v10l-6-3z" />
    </svg>
  );
}

export default function EventDetails({ meetingType: mt, selectedDuration, onDurationChange }: Props) {
  // Long descriptions push the calendar below the fold on phones: clamp them there.
  const long = (mt.description?.length ?? 0) > 180;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="px-5 sm:px-7 pt-6 pb-5 border-b border-[var(--bk-border)]">
      <div className="flex items-center gap-2 mb-3">
        {mt.brand?.logoUrl ? (
          <Image src={mt.brand.logoUrl} alt="" width={20} height={20} className="rounded" unoptimized />
        ) : mt.hostAvatarUrl ? (
          <Image src={mt.hostAvatarUrl} alt="" width={20} height={20} className="rounded-full" unoptimized />
        ) : null}
        <p className="text-xs uppercase tracking-[0.14em] text-[var(--bk-muted)]">
          {mt.brand?.name || mt.hostName}
        </p>
      </div>

      <h1 className="text-xl sm:text-2xl font-semibold mb-2">{mt.name}</h1>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--bk-muted)]">
        {mt.durations.length > 1 ? (
          <div role="radiogroup" aria-label="Duration" className="inline-flex rounded-lg border border-[var(--bk-border)] p-0.5">
            {mt.durations.map((d) => (
              <button
                key={d.minutes}
                type="button"
                role="radio"
                aria-checked={d.minutes === selectedDuration.minutes}
                onClick={() => onDurationChange(d.minutes)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                  d.minutes === selectedDuration.minutes
                    ? "bg-[var(--bk-accent)] text-[var(--bk-accent-ink)]"
                    : "text-[var(--bk-muted)]"
                }`}
              >
                {d.minutes} min
              </button>
            ))}
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <ClockIcon />
            {mt.durationMinutes} min
          </span>
        )}

        {mt.locations.map((l, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <LocationIcon kind={l.kind} />
            {locationLabel(l)}
          </span>
        ))}

        {selectedDuration.priceCents ? (
          <span className="bk-badge">{money(selectedDuration.priceCents, mt.currency)}</span>
        ) : null}
      </div>

      {mt.description && (
        <>
          <div
            id="bk-description"
            className={`mt-3 text-sm text-[var(--bk-muted)] space-y-2 ${
              long && !expanded
                ? "max-h-[4.6rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)] sm:max-h-none sm:[mask-image:none]"
                : ""
            }`}
          >
            {renderDescription(mt.description)}
          </div>
          {long && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls="bk-description"
              onClick={() => setExpanded((v) => !v)}
              className="sm:hidden mt-1 text-sm text-[var(--bk-fg)] underline underline-offset-4"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
