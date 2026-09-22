/** Appends booking details to a meeting type's redirectUrl when redirectPassParams is on. */
export function buildRedirectUrl(
  redirectUrl: string,
  passParams: boolean,
  booking: { id: string; name: string; email: string; startTime: string; endTime: string }
): string {
  if (!passParams) return redirectUrl;
  try {
    const url = new URL(redirectUrl);
    url.searchParams.set("booking_id", booking.id);
    url.searchParams.set("invitee_full_name", booking.name);
    url.searchParams.set("invitee_email", booking.email);
    url.searchParams.set("event_start_time", booking.startTime);
    url.searchParams.set("event_end_time", booking.endTime);
    return url.toString();
  } catch {
    return redirectUrl;
  }
}
