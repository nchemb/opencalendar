import type { Booking, MeetingType } from "@prisma/client";
import { prisma } from "./db";
import { errorMessage, log } from "./logger";
import { getSetting } from "./settings";

/**
 * Fire-and-forget notification to an external system on a confirmed booking.
 * Never fatal — a failed delivery must not affect the booking.
 */
export async function deliverBookingWebhook(
  booking: Booking,
  meetingType: MeetingType
): Promise<void> {
  const url = await getSetting("WEBHOOK_URL");
  if (!url) return;

  const secret = await getSetting("WEBHOOK_SECRET");
  const payload = {
    event: "booking.created",
    booking: {
      id: booking.id,
      name: booking.name,
      email: booking.email,
      meetingType: meetingType.slug,
      meetingTypeName: meetingType.name,
      startTime: booking.startTime.toISOString(),
      endTime: booking.endTime.toISOString(),
      timezone: booking.timezone,
      amountCents: booking.amountCents ?? null,
      customAnswer: booking.customAnswer ?? null,
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "X-BookKit-Secret": secret } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      log.warn("outbound-webhook", "non_2xx", { bookingId: booking.id, status: res.status });
      return;
    }
    await prisma.booking.update({
      where: { id: booking.id },
      data: { webhookDeliveredAt: new Date() },
    });
    log.info("outbound-webhook", "delivered", { bookingId: booking.id });
  } catch (err) {
    log.warn("outbound-webhook", "failed", {
      bookingId: booking.id,
      error: errorMessage(err),
    });
  }
}
