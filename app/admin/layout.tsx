import Link from "next/link";
import { adminSession } from "@/lib/auth";
import { drainJobs } from "@/lib/jobs";
import { openAlerts } from "@/lib/alerts";
import AlertBanner, { type AdminAlert } from "@/components/admin/AlertBanner";
import LoginForm from "./LoginForm";
import LogoutButton from "./LogoutButton";

export const dynamic = "force-dynamic";

export const metadata = { title: "BookKit admin", robots: { index: false } };

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/event-types", label: "Event types" },
  { href: "/admin/availability", label: "Availability" },
  { href: "/admin/brands", label: "Brands" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/settings", label: "Settings" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await adminSession())) {
    return (
      <main className="min-h-dvh grid place-items-center px-4">
        <LoginForm />
      </main>
    );
  }

  // Opportunistic: moves retries along even on a box with no cron configured yet.
  await drainJobs({ budgetMs: 3000 }).catch(() => undefined);
  const alerts = await openAlerts();
  const alertProps: AdminAlert[] = alerts.map((a) => ({
    id: a.id,
    kind: a.kind,
    severity: a.severity as AdminAlert["severity"],
    title: a.title,
    message: a.message,
    bookingId: a.bookingId,
    createdAt: a.createdAt.toISOString(),
  }));

  return (
    <div className="min-h-dvh">
      <header className="border-b border-[var(--bk-border)] sticky top-0 bg-[var(--bk-bg)]/95 backdrop-blur z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-5">
          <Link href="/admin" className="font-semibold tracking-tight">
            BookKit
          </Link>
          <nav className="flex items-center gap-4 text-sm overflow-x-auto">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-[var(--bk-muted)] hover:text-[var(--bk-fg)] whitespace-nowrap">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto">
            <LogoutButton />
          </div>
        </div>
      </header>
      <AlertBanner initial={alertProps} />
      <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
