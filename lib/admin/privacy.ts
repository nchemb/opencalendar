/** K2: delete/export all data for one invitee email. Google events are untouched. */
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";

export async function exportDataForEmail(email: string) {
  const bookings = await prisma.booking.findMany({
    where: { email: email.toLowerCase() },
    include: { events: true, meetingType: { select: { name: true, slug: true } } },
    orderBy: { createdAt: "desc" },
  });
  return { email, exportedAt: new Date().toISOString(), bookings };
}

export async function deleteDataForEmail(email: string): Promise<{ anonymized: number }> {
  const lower = email.toLowerCase();
  const rows = await prisma.booking.findMany({ where: { email: lower }, select: { id: true } });
  if (!rows.length) return { anonymized: 0 };

  for (const b of rows) {
    await prisma.booking.update({
      where: { id: b.id },
      data: {
        name: "Deleted",
        email: `deleted+${b.id}@invalid`,
        answers: Prisma.DbNull,
        customAnswer: null,
        guests: [],
        utm: Prisma.DbNull,
      },
    });
    await audit(b.id, "privacy_deleted", { requestedFor: lower });
  }
  return { anonymized: rows.length };
}
