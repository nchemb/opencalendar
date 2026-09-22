import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import BookingWidget from "@/components/booking/BookingWidget";
import { initialSlots } from "@/lib/ui/initial-slots";
import { bumpMetric } from "@/lib/analytics";
import { hostBookingBlocked } from "@/lib/booking";
import { env } from "@/lib/env";
import { findActiveMeetingType, toPublic } from "@/lib/meeting-types";
import { isBotUserAgent } from "@/lib/ui/bot";
import { parseBookingParams } from "@/lib/ui/params";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function EmbedPage({
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
  const bookingParams = parseBookingParams(
    searchParams,
    publicType.questions.map((q) => q.id)
  );

  if (searchParams.preload !== "1" && !isBotUserAgent(headers().get("user-agent"))) {
    await bumpMetric(meetingType.id, "view", bookingParams.utm.utm_source);
  }

  const brandTheme = publicType.brand?.theme ?? "auto";
  const theme = bookingParams.theme ?? (brandTheme === "auto" ? "dark" : brandTheme);
  if (bookingParams.accent) publicType.color = bookingParams.accent;

  return (
    <div data-theme={theme} className="bk-embed p-1 sm:p-2" style={{ background: "transparent" }}>
      {/* The iframe must not paint its own page background over the host site. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            "html,body{background:transparent !important;margin:0}" +
            // The demo banner lives in the root layout; an embed dropped on
            // someone else's page must not inherit it.
            "[data-bookkit-demo-banner]{display:none !important}",
        }}
      />
      <BookingWidget
        initialSlots={await seedPromise}
        meetingType={publicType}
        hostEmail={host.email}
        blocked={hostBookingBlocked(host)}
        embed
        embedCtx={{ embedId: bookingParams.embedId, slug: params.slug }}
        hideDetails={bookingParams.hideDetails}
        stripePublishableKey={env("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY") ?? null}
        params={bookingParams}
      />
    </div>
  );
}
