import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { money } from "@/lib/ui/format";
import { plainTextPreview } from "@/lib/ui/markdown";

export const dynamic = "force-dynamic";

async function loadBrand(slug: string) {
  const brand = await prisma.brand.findUnique({
    where: { slug },
    include: {
      host: true,
      meetingTypes: {
        where: { active: true, secret: false },
        orderBy: { position: "asc" },
        select: { slug: true, name: true, description: true, durationMinutes: true, priceCents: true, currency: true },
      },
    },
  });
  return brand;
}

export async function generateMetadata({ params }: { params: { brand: string } }): Promise<Metadata> {
  const brand = await loadBrand(params.brand);
  if (!brand) return { title: "Not found" };
  const title = brand.name;
  const description = brand.tagline || `Book time with ${brand.name}.`;
  return {
    title,
    description,
    alternates: { canonical: `/u/${params.brand}` },
    openGraph: { title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function BrandPage({ params }: { params: { brand: string } }) {
  const brand = await loadBrand(params.brand);
  if (!brand) notFound();

  const accent = { ["--bk-accent" as string]: brand.accentColor } as React.CSSProperties;
  const theme = brand.theme === "light" || brand.theme === "dark" ? brand.theme : undefined;

  return (
    <main data-theme={theme} className="min-h-dvh px-4 py-12 sm:py-16">
      <div style={accent} className="max-w-md mx-auto text-center">
        {brand.logoUrl ? (
          <Image src={brand.logoUrl} alt="" width={64} height={64} className="rounded-2xl mx-auto mb-4" unoptimized />
        ) : brand.host.avatarUrl ? (
          <Image src={brand.host.avatarUrl} alt="" width={64} height={64} className="rounded-full mx-auto mb-4" unoptimized />
        ) : null}
        <h1 className="text-2xl font-semibold">{brand.name}</h1>
        {brand.tagline && <p className="text-[var(--bk-muted)] text-sm mt-1.5">{brand.tagline}</p>}

        <div className="mt-8 space-y-2.5 text-left">
          {brand.meetingTypes.map((mt) => (
            <Link key={mt.slug} href={`/${mt.slug}`} className="bk-card block p-4 hover:border-[var(--bk-accent)] transition-colors">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{mt.name}</span>
                <span className="text-xs text-[var(--bk-muted)] whitespace-nowrap">
                  {mt.durationMinutes} min{mt.priceCents ? ` · ${money(mt.priceCents, mt.currency)}` : ""}
                </span>
              </div>
              {mt.description && (
                <p className="text-sm text-[var(--bk-muted)] mt-1 line-clamp-2">{plainTextPreview(mt.description)}</p>
              )}
            </Link>
          ))}
          {brand.meetingTypes.length === 0 && (
            <p className="text-sm text-[var(--bk-muted)] text-center">Nothing bookable here right now.</p>
          )}
        </div>

        {brand.websiteUrl && (
          <a href={brand.websiteUrl} className="inline-block mt-8 text-sm underline text-[var(--bk-muted)]" target="_blank" rel="noreferrer">
            {brand.websiteUrl.replace(/^https?:\/\//, "")}
          </a>
        )}
        {brand.showPoweredBy && (
          <p className="mt-10 text-xs text-[var(--bk-muted)]">
            Powered by{" "}
            <a href="https://github.com/nchemb/opencalendar" className="underline" target="_blank" rel="noreferrer">
              OpenCalendar
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
