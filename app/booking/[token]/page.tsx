import { notFound } from "next/navigation";
import ManageView from "./ManageView";
import { findByManageToken, inviteePolicy } from "@/lib/booking";
import { toPublic } from "@/lib/meeting-types";
import { publicBooking } from "@/lib/booking-request";
import type { LocationOption } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Manage booking", robots: { index: false, follow: false } };

export default async function ManageBookingPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { action?: string };
}) {
  const row = await findByManageToken(params.token);
  if (!row) notFound();
  const { meetingType, host, ...booking } = row;
  const policy = inviteePolicy(booking, meetingType);
  const action = searchParams.action === "reschedule" || searchParams.action === "cancel" ? searchParams.action : null;

  return (
    <main className="min-h-dvh grid place-items-center px-4 py-10">
      <ManageView
        token={params.token}
        booking={{
          ...publicBooking(booking),
          manageToken: params.token,
          status: booking.status,
          location: booking.location as LocationOption | null,
        }}
        meetingType={toPublic(meetingType, host)}
        policy={policy}
        initialAction={action}
      />
    </main>
  );
}
