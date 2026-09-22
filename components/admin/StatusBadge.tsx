export type BadgeTone = "ok" | "warn" | "danger" | "muted";

export default function StatusBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  return (
    <span className={`bk-badge bk-badge-${tone}`}>
      <span className="bk-badge-dot" style={{ background: "currentColor" }} />
      {label}
    </span>
  );
}

const STATUS_TONE: Record<string, BadgeTone> = {
  CONFIRMED: "ok",
  FAILED_NEEDS_INTERVENTION: "danger",
  PENDING_PAYMENT: "warn",
  CANCELLED: "muted",
  EXPIRED: "muted",
};

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: "Confirmed",
  FAILED_NEEDS_INTERVENTION: "Needs attention",
  PENDING_PAYMENT: "Holding",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export function BookingStatusBadge({ status }: { status: string }) {
  return <StatusBadge tone={STATUS_TONE[status] ?? "muted"} label={STATUS_LABEL[status] ?? status} />;
}
