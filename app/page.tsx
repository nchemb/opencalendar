import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const REPO = "https://github.com/nchemb/opencalendar";

const FEATURES = [
  {
    title: "Real Google Calendar availability",
    body: "Slots come from your actual freebusy, not a copy of it. Add a dentist appointment and that slot disappears.",
  },
  {
    title: "Paid bookings via Stripe",
    body: "Put a price on a meeting type and the slot is held while the booker checks out. Abandon it and the hold releases itself.",
  },
  {
    title: "Meet links, automatically",
    body: "Every booking creates a calendar event with a Google Meet link and invites the booker — Google's own invite email is the confirmation.",
  },
  {
    title: "Popup or inline, one script",
    body: "A button that opens the picker over your page, or the calendar rendered straight into it. Same widget.js, both modes.",
  },
  {
    title: "No double bookings",
    body: "Every booking is claimed under a database lock that re-checks your live calendar before it commits. Two people racing for one slot: one wins, one gets a clean error.",
  },
  {
    title: "Never a silent drop",
    body: "If someone pays and the calendar write fails, you get an alert email and a retry button — the booking is never lost quietly.",
  },
];

export default async function Home() {
  // A single-brand instance (the common case — one host, one site) goes straight to its
  // link-in-bio page; the OSS marketing page below only makes sense for a bare/multi-brand install.
  const brandCount = await prisma.brand.count().catch(() => 0);
  if (brandCount === 1) {
    const only = await prisma.brand.findFirstOrThrow({ select: { slug: true } });
    redirect(`/u/${only.slug}`);
  }

  const types = await prisma.meetingType
    .findMany({
      where: { active: true },
      orderBy: { createdAt: "asc" },
      take: 4,
      select: { slug: true, name: true, durationMinutes: true, priceCents: true, color: true },
    })
    .catch(() => []);

  return (
    <main className="min-h-dvh">
      <section className="max-w-3xl mx-auto px-5 pt-20 pb-14">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--bk-muted)] mb-4">
          Open source · MIT
        </p>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.08] mb-5">
          OpenCalendar
          <span className="block text-[var(--bk-muted)] font-normal text-2xl sm:text-3xl mt-2.5">
            Calendly, replaced with something you own.
          </span>
        </h1>
        <p className="text-[var(--bk-muted)] text-lg leading-relaxed mb-8 max-w-xl">
          A self-hosted booking page wired to your Google Calendar, with Stripe checkout for the
          meetings you charge for. One Next.js app, one Postgres database, deployed in about twenty
          minutes.
        </p>

        <div className="flex flex-wrap gap-3">
          {types[0] && (
            <Link className="bk-btn bk-btn-primary" href={`/${types[0].slug}`}>
              See it live
            </Link>
          )}
          <a className="bk-btn bk-btn-ghost" href={REPO} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </div>
      </section>

      {types.length > 0 && (
        <section className="max-w-3xl mx-auto px-5 pb-14">
          <h2 className="text-sm font-medium text-[var(--bk-muted)] mb-3">Live booking pages</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {types.map((t) => (
              <Link key={t.slug} href={`/${t.slug}`} className="bk-card p-4 hover:border-[var(--bk-muted)] transition-colors">
                <div className="flex items-center gap-2.5 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                  <span className="font-medium">{t.name}</span>
                </div>
                <p className="text-sm text-[var(--bk-muted)]">
                  {t.durationMinutes} min · {t.priceCents ? `$${(t.priceCents / 100).toFixed(0)}` : "Free"}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="max-w-3xl mx-auto px-5 pb-16">
        <div className="grid sm:grid-cols-2 gap-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="bk-card p-5">
              <h3 className="font-medium mb-1.5">{f.title}</h3>
              <p className="text-sm text-[var(--bk-muted)] leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-5 pb-20">
        <div className="bk-card p-6">
          <h2 className="font-semibold mb-3">Run your own</h2>
          <p className="text-sm text-[var(--bk-muted)] mb-4">
            Clone it, point it at a free Postgres database, connect your Google account and deploy.
            The README walks the whole path.
          </p>
          <pre className="bg-[var(--bk-surface-2)] border border-[var(--bk-border)] rounded-lg p-4 text-[12.5px] overflow-x-auto mb-4">
{`git clone ${REPO}.git
cd bookkit && npm install
cp .env.example .env   # fill in the blanks
npx prisma migrate deploy
npm run dev`}
          </pre>
          <a className="bk-btn bk-btn-ghost" href={REPO} target="_blank" rel="noreferrer">
            Read the setup guide
          </a>
        </div>
      </section>

      <footer className="border-t border-[var(--bk-border)]">
        <div className="max-w-3xl mx-auto px-5 py-6 flex flex-wrap gap-4 items-center text-sm text-[var(--bk-muted)]">
          <span>OpenCalendar — MIT licensed</span>
          <a className="ml-auto hover:text-[var(--bk-fg)]" href={REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <Link className="hover:text-[var(--bk-fg)]" href="/admin">
            Admin
          </Link>
        </div>
      </footer>
    </main>
  );
}
