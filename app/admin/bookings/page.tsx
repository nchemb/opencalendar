import { getHost } from "@/lib/booking";
import { prisma } from "@/lib/db";
import BookingsTable, { type AdminBooking } from "./BookingsTable";

export const dynamic = "force-dynamic";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const host = await getHost();

  const rows = await prisma.booking.findMany({
    orderBy: { startTime: "desc" },
    take: 300,
    include: { meetingType: { select: { name: true, color: true, slug: true } } },
  });

  const bookings: AdminBooking[] = rows.map((b) => ({
    id: b.id,
    name: b.name,
    email: b.email,
    status: b.status,
    startTime: b.startTime.toISOString(),
    endTime: b.endTime.toISOString(),
    bookerTimezone: b.timezone,
    meetLink: b.meetLink,
    amountCents: b.amountCents,
    paymentStatus: b.stripePaymentStatus,
    customAnswer: b.customAnswer,
    syncError: b.googleSyncError,
    cancelToken: b.cancelToken,
    createdAt: b.createdAt.toISOString(),
    meetingType: b.meetingType,
  }));

  return (
    <BookingsTable
      bookings={bookings}
      hostTimezone={host?.timezone ?? "UTC"}
      initialStatus={searchParams.status ?? "ALL"}
    />
  );
}
