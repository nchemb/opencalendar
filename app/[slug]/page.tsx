import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BookingFlow from "@/components/booking/BookingFlow";
import { env } from "@/lib/env";
import { findActiveMeetingType, toPublic } from "@/lib/meeting-types";
import { hostBookingBlocked } from "@/lib/booking";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const found = await findActiveMeetingType(params.slug);
  if (!found) return { title: "Not found" };
  const { meetingType, host } = found;
  return {
    title: `${meetingType.name} — ${host.displayName || host.email}`,
    description:
      meetingType.description ??
      `Book a ${meetingType.durationMinutes} minute ${meetingType.name}.`,
  };
}

export default async function BookingPage({ params }: { params: { slug: string } }) {
  const found = await findActiveMeetingType(params.slug);
  if (!found) notFound();

  const { meetingType, host } = found;

  return (
    <main className="min-h-dvh px-4 py-8 sm:py-14">
      <BookingFlow
        meetingType={toPublic(meetingType, host)}
        hostEmail={host.email}
        blocked={hostBookingBlocked(host)}
        stripePublishableKey={env("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY") ?? null}
      />
    </main>
  );
}
