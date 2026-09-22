import { POST as createBooking } from "../../bookings/route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** v1 path. Same as POST /api/bookings for a paid meeting type. */
export async function POST(req: Request) {
  const res = await createBooking(req);
  const data = await res.json();
  if (!data.ok) return Response.json(data, { status: res.status });
  return Response.json({ ok: true, bookingId: data.booking.id, clientSecret: data.payment?.clientSecret, expiresAt: data.payment?.expiresAt, booking: data.booking });
}
