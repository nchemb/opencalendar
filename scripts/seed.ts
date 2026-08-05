/**
 * One-time bootstrap: creates the host row (so you can log in and connect Google)
 * plus a starter meeting type. Safe to re-run — it never overwrites existing data.
 *
 *   npm run seed
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_WEEKLY_HOURS } from "../lib/types";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim();
  if (!email) throw new Error("Set ADMIN_EMAIL in .env before seeding.");

  const timezone = process.env.HOST_TIMEZONE?.trim() || "America/Chicago";

  let host = await prisma.host.findFirst({ orderBy: { createdAt: "asc" } });
  if (!host) {
    host = await prisma.host.create({ data: { email, timezone } });
    console.log(`created host ${host.email} (${host.timezone})`);
  } else {
    console.log(`host already exists: ${host.email}`);
  }

  const count = await prisma.meetingType.count();
  if (count === 0) {
    const created = await prisma.meetingType.create({
      data: {
        hostId: host.id,
        slug: "intro-call",
        name: "Intro call",
        description: "A quick 30 minutes to work out whether this is a fit.",
        durationMinutes: 30,
        priceCents: null,
        color: "#FF6A00",
        weeklyHours: DEFAULT_WEEKLY_HOURS,
        daysInAdvance: 14,
        minNoticeHours: 12,
        bufferMinutes: 0,
        questions: [{ label: "What do you want to get out of this call?", required: false }],
        displayMode: "popup",
        active: true,
      },
    });
    console.log(`created meeting type /${created.slug}`);
  } else {
    console.log(`${count} meeting type(s) already exist — skipped`);
  }

  console.log("\nNext: open /admin, log in, and connect Google Calendar.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
