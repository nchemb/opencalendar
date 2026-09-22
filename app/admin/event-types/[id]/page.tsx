import { notFound } from "next/navigation";
import { appUrl } from "@/lib/env";
import { prisma } from "@/lib/db";
import { getHost } from "@/lib/booking";
import { parseLocations, parseQuestions } from "@/lib/types";
import EventTypeEditor, { type EditableEventType } from "./EventTypeEditor";
import SingleUseLinks from "./SingleUseLinks";
import SharePanel from "@/components/admin/SharePanel";

export const dynamic = "force-dynamic";

const BLANK: EditableEventType = {
  id: "",
  slug: "",
  name: "",
  description: "",
  brandId: "",
  scheduleId: "",
  durationMinutes: 30,
  durationOptions: [],
  priceCents: null,
  currency: "usd",
  color: "#FF6A00",
  windowType: "CALENDAR_DAYS",
  daysInAdvance: 30,
  windowStart: "",
  windowEnd: "",
  minNoticeMinutes: 720,
  startIncrementMinutes: null,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  dailyLimit: null,
  weeklyLimit: null,
  locations: [{ kind: "google_meet" }],
  questions: [],
  allowGuests: true,
  maxGuests: 10,
  redirectUrl: "",
  redirectPassParams: false,
  confirmationNote: "",
  cancelCutoffHours: null,
  refundPolicy: "before_cutoff",
  policyText: "",
  reminderMinutes: [1440, 60],
  followUpMinutes: null,
  secret: false,
  displayMode: "popup",
  active: true,
};

export default async function EventTypeEditorPage({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const [host, brands, schedules, existing] = await Promise.all([
    getHost(),
    prisma.brand.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.schedule.findMany({ orderBy: { createdAt: "asc" } }),
    isNew ? null : prisma.meetingType.findUnique({ where: { id: params.id } }),
  ]);
  if (!isNew && !existing) notFound();

  const value: EditableEventType = existing
    ? {
        id: existing.id,
        slug: existing.slug,
        name: existing.name,
        description: existing.description ?? "",
        brandId: existing.brandId ?? "",
        scheduleId: existing.scheduleId ?? "",
        durationMinutes: existing.durationMinutes,
        durationOptions: Array.isArray(existing.durationOptions) ? (existing.durationOptions as { minutes: number; priceCents: number | null }[]) : [],
        priceCents: existing.priceCents,
        currency: existing.currency,
        color: existing.color,
        windowType: existing.windowType,
        daysInAdvance: existing.daysInAdvance,
        windowStart: existing.windowStart ?? "",
        windowEnd: existing.windowEnd ?? "",
        minNoticeMinutes: existing.minNoticeMinutes,
        startIncrementMinutes: existing.startIncrementMinutes,
        bufferBeforeMinutes: existing.bufferBeforeMinutes,
        bufferAfterMinutes: existing.bufferAfterMinutes,
        dailyLimit: existing.dailyLimit,
        weeklyLimit: existing.weeklyLimit,
        locations: parseLocations(existing.locations),
        questions: parseQuestions(existing.questions),
        allowGuests: existing.allowGuests,
        maxGuests: existing.maxGuests,
        redirectUrl: existing.redirectUrl ?? "",
        redirectPassParams: existing.redirectPassParams,
        confirmationNote: existing.confirmationNote ?? "",
        cancelCutoffHours: existing.cancelCutoffHours,
        refundPolicy: existing.refundPolicy as EditableEventType["refundPolicy"],
        policyText: existing.policyText ?? "",
        reminderMinutes: existing.reminderMinutes,
        followUpMinutes: existing.followUpMinutes,
        secret: existing.secret,
        displayMode: existing.displayMode,
        active: existing.active,
      }
    : BLANK;

  return (
    <div className="space-y-8">
      <EventTypeEditor
        value={value}
        isNew={isNew}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
        schedules={schedules.map((s) => ({ id: s.id, name: s.name, timezone: s.timezone }))}
        hostReady={Boolean(host)}
      />

      {!isNew && (
        <>
          <section className="bk-card p-5">
            <h2 className="font-semibold mb-3">Live preview</h2>
            <iframe
              src={`${appUrl()}/embed/${value.slug}?hide_details=0`}
              className="w-full rounded-lg border border-[var(--bk-border)]"
              style={{ minHeight: 560 }}
              title="Booking page preview"
            />
          </section>

          <section className="bk-card p-5">
            <h2 className="font-semibold mb-3">Single-use links</h2>
            <SingleUseLinks meetingTypeId={value.id} baseUrl={appUrl()} slug={value.slug} />
          </section>

          <section className="bk-card p-5">
            <h2 className="font-semibold mb-3">Share</h2>
            <SharePanel baseUrl={appUrl()} slug={value.slug} color={value.color} displayMode={value.displayMode} />
          </section>
        </>
      )}
    </div>
  );
}
