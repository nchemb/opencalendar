/**
 * Resets and seeds the end-to-end database. Run by Playwright's globalSetup, and
 * reusable by hand:
 *
 *   DATABASE_URL=postgresql://…/bookkit_e2e npx tsx tests/e2e/seed-e2e.ts
 *
 * The same shape backs the hosted demo instance, so what a contributor clicks
 * through locally is what a stranger sees on the demo.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Every day 09:00–17:00 host-local, so a slot is always within a day or two. */
const ALL_WEEK = Object.fromEntries(
  ["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "09:00", end: "17:00" }]])
);

export const E2E = {
  hostEmail: "demo@bookkit.test",
  hostName: "Dana Demo",
  timezone: "America/Chicago",
  free: "intro-call",
  questions: "strategy-call",
  paid: "paid-consult",
  inactive: "archived-call",
};

export async function seedE2E(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Booking", "MeetingType", "Host", "Setting" RESTART IDENTITY CASCADE'
  );

  const host = await prisma.host.create({
    data: {
      email: E2E.hostEmail,
      displayName: E2E.hostName,
      timezone: E2E.timezone,
      // Demo mode swaps in the in-memory calendar, but hostBookingBlocked()
      // still checks that a host looks connected.
      googleRefreshToken: "demo-refresh-token",
      googleConnectedAt: new Date(),
    },
  });

  const common = {
    hostId: host.id,
    durationMinutes: 30,
    currency: "usd",
    weeklyHours: ALL_WEEK as object,
    daysInAdvance: 30,
    minNoticeHours: 0,
    bufferMinutes: 0,
    active: true,
  };

  await prisma.meetingType.createMany({
    data: [
      {
        ...common,
        slug: E2E.free,
        name: "Intro call",
        description: "A quick 30 minutes to work out whether this is a fit.",
        color: "#FF6A00",
        displayMode: "popup",
      },
      {
        ...common,
        slug: E2E.questions,
        name: "Strategy call",
        description: "Bring a problem, leave with a plan.",
        color: "#4F8DFD",
        displayMode: "inline",
        questions: [
          { label: "What are you building?", required: true },
          { label: "Anything else?", required: false },
        ] as object,
      },
      {
        ...common,
        slug: E2E.paid,
        name: "Paid consult",
        description: "A deep dive, priced accordingly.",
        priceCents: 6900,
        color: "#22C55E",
        displayMode: "popup",
      },
      {
        ...common,
        slug: E2E.inactive,
        name: "Archived call",
        description: "No longer bookable.",
        color: "#888888",
        active: false,
      },
    ],
  });
}

// Allow running this file directly.
if (process.argv[1]?.includes("seed-e2e")) {
  seedE2E()
    .then(() => console.log("e2e database seeded"))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
