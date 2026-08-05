import Link from "next/link";
import { isAdmin } from "@/lib/auth";
import LoginForm from "./LoginForm";
import LogoutButton from "./LogoutButton";

export const dynamic = "force-dynamic";

export const metadata = { title: "BookKit admin", robots: { index: false } };

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/meeting-types", label: "Meeting types" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/settings", label: "Settings" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isAdmin()) {
    return (
      <main className="min-h-dvh grid place-items-center px-4">
        <LoginForm />
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-[var(--bk-border)] sticky top-0 bg-[var(--bk-bg)]/95 backdrop-blur z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-5">
          <span className="font-semibold tracking-tight">BookKit</span>
          <nav className="flex items-center gap-4 text-sm overflow-x-auto">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[var(--bk-muted)] hover:text-[var(--bk-fg)] whitespace-nowrap"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto">
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
