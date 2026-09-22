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

function LocationIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="m16 10 6-3v10l-6-3z" />
    </svg>
  );
}

export default function EventDetails({ meetingType: mt, selectedDuration, onDurationChange }: Props) {
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
            <LocationIcon />
            {locationLabel(l)}
          </span>
        ))}

        {selectedDuration.priceCents ? (
          <span className="bk-badge">{money(selectedDuration.priceCents, mt.currency)}</span>
        ) : null}
      </div>

      {mt.description && (
        <div className="mt-3 text-sm text-[var(--bk-muted)] space-y-2">{renderDescription(mt.description)}</div>
      )}
    </div>
  );
}
