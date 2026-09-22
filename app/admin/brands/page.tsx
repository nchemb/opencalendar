import { appUrl } from "@/lib/env";
import { prisma } from "@/lib/db";
import BrandsManager, { type EditableBrand } from "./BrandsManager";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const rows = await prisma.brand.findMany({ orderBy: { createdAt: "asc" } });
  const brands: EditableBrand[] = rows.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    tagline: b.tagline ?? "",
    logoUrl: b.logoUrl ?? "",
    accentColor: b.accentColor,
    theme: b.theme as EditableBrand["theme"],
    websiteUrl: b.websiteUrl ?? "",
    replyTo: b.replyTo ?? "",
    showPoweredBy: b.showPoweredBy,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Brands</h1>
      <p className="text-[var(--bk-muted)] text-sm -mt-3">Each brand gets its own name, logo, accent color and profile page at /u/&lt;slug&gt;. Event types belong to a brand.</p>
      <BrandsManager brands={brands} baseUrl={appUrl()} />
    </div>
  );
}
