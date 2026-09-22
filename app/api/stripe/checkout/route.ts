import { POST as createBooking } from "../../bookings/route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** v1 path: hosted Stripe Checkout. Same as POST /api/bookings with checkout=true. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const res = await createBooking(
    new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify({ ...(body ?? {}), checkout: true }) })
  );
  const data = await res.json();
  if (!data.ok) return Response.json(data, { status: res.status });
  return Response.json({ ok: true, bookingId: data.booking.id, checkoutUrl: data.payment?.checkoutUrl, booking: data.booking });
}
