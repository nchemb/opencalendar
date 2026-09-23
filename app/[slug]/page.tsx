import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import BookingWidget from "@/components/booking/BookingWidget";
import { initialSlots } from "@/lib/ui/initial-slots";
import { bumpMetric } from "@/lib/analytics";
import { hostBookingBlocked } from "@/lib/booking";
import { appUrl, env } from "@/lib/env";
import { findActiveMeetingType, toPublic } from "@/lib/meeting-types";
import { isBotUserAgent } from "@/lib/ui/bot";
import { parseBookingParams } from "@/lib/ui/params";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const found = await findActiveMeetingType(params.slug);
  if (!found) return { title: "Not found" };
  const { meetingType, host } = found;
  const title = `${meetingType.name} — ${meetingType.brand?.name || host.displayName || host.email}`;
  const description = meetingType.description ?? `Book a ${meetingType.durationMinutes} minute ${meetingType.name}.`;
  return {
    title,
    description,
    alternates: { canonical: `/${params.slug}`, types: { "text/plain": `${appUrl()}/llms.txt` } },
    openGraph: { title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const found = await findActiveMeetingType(params.slug);
  if (!found) notFound();
  const { meetingType, host } = found;
  const publicType = toPublic(meetingType, host);
  const seedPromise = initialSlots(host, meetingType, {
    link: typeof searchParams.link === "string" ? searchParams.link : null,
    duration: typeof searchParams.duration === "string" ? Number(searchParams.duration) : null,
  });

  if (!isBotUserAgent(headers().get("user-agent"))) {
    await bumpMetric(meetingType.id, "view", searchParams.utm_source as string | undefined);
  }

  return (
    <main className="min-h-dvh px-4 py-8 sm:py-14">
      <BookingWidget
        initialSlots={await seedPromise}
        meetingType={publicType}
        hostEmail={host.email}
        blocked={hostBookingBlocked(host)}
        stripePublishableKey={env("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY") ?? null}
        params={parseBookingParams(
          searchParams,
          publicType.questions.map((q) => q.id)
        )}
      />
    </main>
  );
}
