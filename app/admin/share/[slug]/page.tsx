import { notFound } from "next/navigation";
import { appUrl } from "@/lib/env";
import { prisma } from "@/lib/db";
import SharePanel from "@/components/admin/SharePanel";

export const dynamic = "force-dynamic";

export default async function SharePage({ params }: { params: { slug: string } }) {
  const mt = await prisma.meetingType.findUnique({ where: { slug: params.slug }, include: { brand: true } });
  if (!mt) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Share “{mt.name}”</h1>
        <p className="text-[var(--bk-muted)] text-sm">/{mt.slug}</p>
      </div>
      <div className="bk-card p-5">
        <SharePanel baseUrl={appUrl()} slug={mt.slug} color={mt.brand?.accentColor || mt.color} displayMode={mt.displayMode} brandSlug={mt.brand?.slug} />
      </div>
    </div>
  );
}
