/**
 * One-time bootstrap: the host row, a default schedule, a brand and a starter
 * meeting type. Safe to re-run — it never overwrites existing data.
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
    // With the in-memory calendar there is no Google to connect; mark the host as connected.
    const memory = process.env.BOOKKIT_CALENDAR?.trim() === "memory";
    host = await prisma.host.create({
      data: {
        email,
        timezone,
        displayName: email.split("@")[0],
        ...(memory ? { googleRefreshToken: "memory-calendar", googleConnectedAt: new Date() } : {}),
      },
    });
    console.log(`created host ${host.email} (${host.timezone})`);
  } else {
    console.log(`host already exists: ${host.email}`);
  }

  let schedule = await prisma.schedule.findFirst({ where: { hostId: host.id, isDefault: true } });
  if (!schedule) {
    schedule = await prisma.schedule.create({
      data: { hostId: host.id, name: "Working hours", timezone, weeklyHours: DEFAULT_WEEKLY_HOURS, isDefault: true },
    });
    console.log(`created schedule "${schedule.name}"`);
  }

  let brand = await prisma.brand.findFirst({ where: { hostId: host.id } });
  if (!brand) {
    brand = await prisma.brand.create({
      data: { hostId: host.id, slug: "me", name: host.displayName || "My bookings", accentColor: "#FF6A00" },
    });
    console.log(`created brand /u/${brand.slug}`);
  }

  if ((await prisma.meetingType.count()) === 0) {
    const created = await prisma.meetingType.create({
      data: {
        hostId: host.id,
        brandId: brand.id,
        scheduleId: schedule.id,
        slug: "intro-call",
        name: "Intro call",
        description: "A quick 30 minutes to work out whether this is a fit.",
        durationMinutes: 30,
        daysInAdvance: 14,
        minNoticeMinutes: 12 * 60,
        questions: [{ id: "goal", label: "What do you want to get out of this call?", type: "long_text", required: false }],
        locations: [{ kind: "google_meet" }],
      },
    });
    console.log(`created meeting type /${created.slug}`);
  } else {
    console.log("meeting types already exist — skipped");
  }

  console.log("\nNext: open /admin, log in, and connect Google Calendar.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
