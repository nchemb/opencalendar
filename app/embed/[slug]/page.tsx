import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BookingFlow from "@/components/booking/BookingFlow";
import { env } from "@/lib/env";
import { findActiveMeetingType, hostBookingBlocked, toPublic } from "@/lib/meeting-types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type Search = {
  theme?: string;
  primaryColor?: string;
  hideDescription?: string;
  hideHeader?: string;
};

/** Accepts "FF6A00" or "#FF6A00"; anything else falls back to the meeting type's color. */
function safeColor(input: string | undefined, fallback: string): string {
  if (!input) return fallback;
  const v = input.startsWith("#") ? input : `#${input}`;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: Search;
}) {
  const found = await findActiveMeetingType(params.slug);
  if (!found) notFound();

  const { meetingType, host } = found;
  const theme = searchParams.theme === "light" ? "light" : "dark";
  const publicType = {
    ...toPublic(meetingType, host),
    color: safeColor(searchParams.primaryColor, meetingType.color),
  };

  return (
    <div data-theme={theme} className="bk-embed p-1 sm:p-2" style={{ background: "transparent" }}>
      {/* The iframe must not paint its own page background over the host site. */}
      <style
        dangerouslySetInnerHTML={{
          __html: "html,body{background:transparent !important;margin:0}",
        }}
      />
      <BookingFlow
        meetingType={publicType}
        hostEmail={host.email}
        blocked={hostBookingBlocked(host)}
        embed
        hideDescription={searchParams.hideDescription === "true" || searchParams.hideDescription === "1"}
        chrome={!(searchParams.hideHeader === "true" || searchParams.hideHeader === "1")}
        stripePublishableKey={env("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY") ?? null}
      />
    </div>
  );
}
