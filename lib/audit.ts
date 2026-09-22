import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { errorMessage, log } from "./logger";

type Client = Pick<typeof prisma, "bookingEvent">;

/** Append to a booking's audit log. Never throws: the log must not break a booking. */
export async function audit(
  bookingId: string,
  type: string,
  detail?: Record<string, unknown>,
  client: Client = prisma
): Promise<void> {
  try {
    await client.bookingEvent.create({
      data: { bookingId, type, detail: (detail ?? undefined) as Prisma.InputJsonValue | undefined },
    });
  } catch (err) {
    log.warn("audit", "write_failed", { bookingId, type, error: errorMessage(err) });
  }
}
