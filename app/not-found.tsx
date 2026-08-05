import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="bk-card p-7 max-w-sm w-full text-center">
        <h1 className="text-lg font-semibold mb-2">Nothing here</h1>
        <p className="text-[var(--bk-muted)] text-sm mb-5">
          That booking page does not exist, or it has been turned off.
        </p>
        <Link className="bk-btn bk-btn-ghost" href="/">
          Go home
        </Link>
      </div>
    </main>
  );
}
