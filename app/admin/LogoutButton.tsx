"use client";

export default function LogoutButton() {
  return (
    <button
      type="button"
      className="text-sm text-[var(--bk-muted)] hover:text-[var(--bk-fg)]"
      onClick={async () => {
        await fetch("/api/admin/session", { method: "DELETE" });
        window.location.href = "/admin";
      }}
    >
      Log out
    </button>
  );
}
