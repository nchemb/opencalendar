import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { formatPrice } from "@/lib/stripe";
import { manageUrl, whereText } from "@/lib/emails";
import { locationLabel, type LocationOption } from "@/lib/types";
import { BookingStatusBadge } from "@/components/admin/StatusBadge";
import { CopyBox } from "@/components/admin/CopyButton";
import BookingActions from "./BookingActions";
import RetryJobButton from "./RetryJobButton";

export const dynamic = "force-dynamic";

export default async function BookingDetailPage({ params }: { params: { id: string } }) {
  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
    include: {
      meetingType: { include: { brand: true, schedule: true } },
      host: true,
      events: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!booking) notFound();

  const jobs = await prisma.job.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: "desc" } });

  const tz = booking.host.timezone;
  const answers = Array.isArray(booking.answers) ? (booking.answers as { label: string; answer: string }[]) : [];
  const utm = booking.utm as Record<string, string> | null;
  const loc = booking.location as LocationOption | null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-2xl font-semibold mb-1">{booking.name}</h1>
          <p className="text-[var(--bk-muted)] text-sm">{booking.email}</p>
        </div>
        <div className="ml-auto">
          <BookingStatusBadge status={booking.status} />
        </div>
      </div>

      <section className="bk-card p-5 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Field label="Meeting type" value={`${booking.meetingType.name} (/${booking.meetingType.slug})`} />
        <Field label="When (host tz)" value={DateTime.fromJSDate(booking.startTime, { zone: tz }).toFormat("cccc, LLL d, yyyy 'at' h:mm a")} />
        <Field label="Duration" value={`${Math.round((booking.endTime.getTime() - booking.startTime.getTime()) / 60_000)} min`} />
        <Field label="Invitee timezone" value={booking.timezone} />
        <Field label="Location" value={loc ? `${locationLabel(loc)}${loc.value ? ` — ${loc.value}` : ""}` : "—"} />
        <Field label="Guests" value={booking.guests.length ? booking.guests.join(", ") : "None"} />
        <Field label="Payment" value={booking.amountCents ? `${formatPrice(booking.amountCents, booking.meetingType.currency)} — ${booking.stripePaymentStatus ?? "unpaid"}` : "Free"} />
        <Field label="Source" value={utm ? Object.entries(utm).map(([k, v]) => `${k}=${v}`).join(" · ") : "—"} />
        <Field label="No-show" value={booking.noShow ? "Yes" : "No"} />
        <Field label="Rescheduled" value={booking.rescheduleCount > 0 ? `${booking.rescheduleCount}x` : "No"} />
        {booking.meetLink && <Field label="Meet link" value={booking.meetLink} link={booking.meetLink} />}
        {booking.stripeSessionId && <Field label="Stripe session" value={booking.stripeSessionId} />}
        {booking.stripePaymentIntentId && <Field label="Stripe payment intent" value={booking.stripePaymentIntentId} />}
        {booking.googleEventId && <Field label="Google event id" value={booking.googleEventId} />}
        {booking.googleSyncError && <Field label="Calendar sync error" value={booking.googleSyncError} danger />}
        {booking.cancelReason && <Field label={booking.cancelledAt ? "Cancel reason" : "Reschedule note"} value={booking.cancelReason} />}
      </section>

      {answers.length > 0 && (
        <section className="bk-card p-5">
          <h2 className="font-semibold mb-3">Answers</h2>
          <dl className="space-y-3 text-sm">
            {answers.map((a, i) => (
              <div key={i}>
                <dt className="text-[var(--bk-muted)]">{a.label}</dt>
                <dd className="whitespace-pre-wrap">{a.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="bk-card p-5">
        <CopyBox label="Manage link (reschedule / cancel, sent to invitee)" code={manageUrl(booking)} />
      </section>

      <BookingActions
        booking={{
          id: booking.id,
          status: booking.status,
          noShow: booking.noShow,
          paid: booking.stripePaymentStatus === "paid",
          hasGoogleEvent: Boolean(booking.googleEventId),
          meetingTypeSlug: booking.meetingType.slug,
          durationMinutes: Math.round((booking.endTime.getTime() - booking.startTime.getTime()) / 60_000),
          startTime: booking.startTime.toISOString(),
        }}
        hostTimezone={tz}
      />

      <section>
        <h2 className="font-semibold mb-3">Jobs</h2>
        {jobs.length === 0 ? (
          <p className="text-[var(--bk-muted)] text-sm">No background jobs for this booking.</p>
        ) : (
          <div className="space-y-2">
            {jobs.map((j) => (
              <div key={j.id} className="bk-card p-3 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                <code className="text-xs">{j.kind}</code>
                <span className="text-[var(--bk-muted)]">
                  {j.doneAt ? "done" : j.deadAt ? "dead" : `attempt ${j.attempts}/${j.maxAttempts}`}
                </span>
                {j.lastError && <span className="text-xs break-all" style={{ color: "var(--bk-danger)" }}>{j.lastError}</span>}
                {!j.doneAt && (
                  <div className="ml-auto">
                    <RetryJobButton jobId={j.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-3">Audit log</h2>
        <div className="space-y-2">
          {booking.events.map((e) => (
            <div key={e.id} className="text-sm flex flex-wrap gap-x-3 items-baseline">
              <span className="text-[var(--bk-muted)] tabular-nums text-xs">
                {DateTime.fromJSDate(e.createdAt, { zone: tz }).toFormat("LLL d, h:mm:ss a")}
              </span>
              <span className="font-medium">{e.type}</span>
              {e.detail ? <code className="text-xs text-[var(--bk-muted)] break-all">{JSON.stringify(e.detail)}</code> : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, link, danger }: { label: string; value: string; link?: string; danger?: boolean }) {
  return (
    <div>
      <p className="text-xs text-[var(--bk-muted)] mb-0.5">{label}</p>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" className="underline break-all">
          {value}
        </a>
      ) : (
        <p className="break-all" style={danger ? { color: "var(--bk-danger)" } : undefined}>
          {value}
        </p>
      )}
    </div>
  );
}
