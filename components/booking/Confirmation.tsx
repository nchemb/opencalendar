"use client";

import { DateTime } from "luxon";
import { googleCalendarLink, outlookCalendarLink } from "@/lib/ics";
import { locationLabel, type LocationOption } from "@/lib/types";

export type ConfirmedBooking = {
  id: string;
  startTime: string;
  endTime: string;
  timezone: string;
  name: string;
  email: string;
  meetLink: string | null;
  manageToken: string | null;
  location: LocationOption | null;
  calendarPending: boolean;
};

type Props = {
  booking: ConfirmedBooking;
  meetingTypeName: string;
  /** Suppressed inside an embed's confirmed step — the manage page is a full navigation. */
  showManageLinks?: boolean;
};

export default function Confirmation({ booking, meetingTypeName, showManageLinks = true }: Props) {
  const start = DateTime.fromISO(booking.startTime, { zone: booking.timezone });
  const end = DateTime.fromISO(booking.endTime, { zone: booking.timezone });
  const item = {
    uid: booking.id,
    title: meetingTypeName,
    description: booking.meetLink ? `Google Meet: ${booking.meetLink}` : "",
    location: booking.location && booking.location.kind !== "google_meet" ? locationLabel(booking.location) : booking.meetLink,
    start: new Date(booking.startTime),
    end: new Date(booking.endTime),
  };

  return (
    <div className="bk-fade">
      <div
        className="w-11 h-11 rounded-full grid place-items-center mb-5"
        style={{ background: "color-mix(in srgb, var(--bk-accent) 18%, transparent)" }}
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--bk-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>

      <h1 className="text-2xl font-semibold mb-1">You&apos;re booked</h1>
      <p className="text-[var(--bk-muted)] text-sm mb-6">
        {meetingTypeName} — a calendar invite is on its way to {booking.email}.
      </p>

      <div className="rounded-xl border border-[var(--bk-border)] p-4 mb-5">
        <p className="font-semibold">{start.toFormat("cccc, LLLL d, yyyy")}</p>
        <p className="text-[var(--bk-muted)] text-sm mt-0.5">
          {start.toFormat("h:mm a")} – {end.toFormat("h:mm a")} ({start.toFormat("ZZZZ")})
        </p>
        {booking.location && booking.location.kind !== "google_meet" && (
          <p className="text-[var(--bk-muted)] text-sm mt-2">{locationLabel(booking.location)}</p>
        )}
      </div>

      {booking.calendarPending && (
        <div className="flex gap-2 mb-3">
          <a className="bk-btn bk-btn-primary flex-1" href={googleCalendarLink(item)} target="_blank" rel="noreferrer">
            Google
          </a>
          <a className="bk-btn bk-btn-ghost flex-1" href={outlookCalendarLink(item)} target="_blank" rel="noreferrer">
            Outlook
          </a>
          {booking.manageToken && (
            <a className="bk-btn bk-btn-ghost flex-1" href={`/api/bookings/ics/${booking.manageToken}`}>
              .ics
            </a>
          )}
        </div>
      )}

      {booking.meetLink && (
        <p className="text-xs text-[var(--bk-muted)] mt-1 mb-3 break-all">
          Meet link for when it&apos;s time:{" "}
          <a className="underline" href={booking.meetLink} target="_blank" rel="noreferrer">
            {booking.meetLink.replace("https://", "")}
          </a>
        </p>
      )}

      {showManageLinks && booking.manageToken && (
        <p className="text-xs text-[var(--bk-muted)] mt-4 text-center">
          Need to change it?{" "}
          <a className="underline" href={`/booking/${booking.manageToken}`}>
            Reschedule or cancel
          </a>
        </p>
      )}
    </div>
  );
}
