import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import CancelView from "./CancelView";

export const dynamic = "force-dynamic";

export const metadata = { title: "Cancel booking", robots: { index: false } };

export default async function CancelPage({ params }: { params: { token: string } }) {
  const booking = await prisma.booking.findUnique({
    where: { cancelToken: params.token },
    select: {
      id: true,
      status: true,
      startTime: true,
      endTime: true,
      timezone: true,
      name: true,
      stripePaymentStatus: true,
      meetingType: { select: { name: true, slug: true, color: true } },
    },
  });

  if (!booking) notFound();

  return (
    <main className="min-h-dvh grid place-items-center px-4 py-10">
      <CancelView
        token={params.token}
        booking={{
          status: booking.status,
          startTime: booking.startTime.toISOString(),
          endTime: booking.endTime.toISOString(),
          timezone: booking.timezone,
          name: booking.name,
          paid: booking.stripePaymentStatus === "paid",
          meetingType: booking.meetingType,
        }}
      />
    </main>
  );
}
