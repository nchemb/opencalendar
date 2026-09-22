"use client";

export default function LogoutButton() {
  async function logout(everywhere: boolean) {
    await fetch(`/api/admin/session${everywhere ? "?all=1" : ""}`, { method: "DELETE" });
    window.location.href = "/admin";
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" className="text-sm text-[var(--bk-muted)] hover:text-[var(--bk-fg)]" onClick={() => logout(false)}>
        Log out
      </button>
      <button
        type="button"
        className="text-xs text-[var(--bk-muted)] hover:text-[var(--bk-fg)] underline"
        onClick={() => {
          if (confirm("Sign out every device using this admin password?")) logout(true);
        }}
      >
        everywhere
      </button>
    </div>
  );
}
