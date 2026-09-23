import { isDemoMode } from "@/lib/env";

/**
 * Shown on every page of the hosted demo. Renders nothing anywhere else, so it
 * is safe to leave mounted in the root layout.
 */
export default function DemoBanner() {
  if (!isDemoMode()) return null;

  return (
    <div
      role="note"
      data-bookkit-demo-banner=""
      style={{
        background: "#FF6A00",
        color: "#0b0b0c",
        fontSize: 13,
        fontWeight: 500,
        textAlign: "center",
        padding: "8px 16px",
        lineHeight: 1.4,
      }}
    >
      Demo instance — book anything you like. Nothing reaches a real calendar,
      payments are disabled, and bookings are wiped daily.{" "}
      <a
        href="https://github.com/nchemb/opencalendar"
        style={{ color: "#0b0b0c", textDecoration: "underline" }}
      >
        Self-host it
      </a>
    </div>
  );
}
