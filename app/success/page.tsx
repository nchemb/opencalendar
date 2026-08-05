import { Suspense } from "react";
import SuccessView from "./SuccessView";

export const dynamic = "force-dynamic";

export const metadata = { title: "Booking confirmed", robots: { index: false } };

export default function SuccessPage() {
  return (
    <main className="min-h-dvh grid place-items-center px-4 py-10">
      <Suspense fallback={<p className="text-[var(--bk-muted)] text-sm">Loading…</p>}>
        <SuccessView />
      </Suspense>
    </main>
  );
}
