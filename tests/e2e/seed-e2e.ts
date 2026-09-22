/**
 * Resets and seeds the end-to-end database. Run by Playwright's globalSetup, and
 * reusable by hand:
 *
 *   DATABASE_URL=postgresql://…/bookkit_e2e npx tsx tests/e2e/seed-e2e.ts
 *
 * v2 schema: MeetingType carries the window/buffer/limit fields, typed questions
 * with ids, and an optional Brand. Weekly hours are wide open (00:00–23:59) so a
 * slot always exists regardless of what time the suite happens to run.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ALL_WEEK = Object.fromEntries(
  ["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "00:00", end: "23:59" }]])
);

export const E2E = {
  hostEmail: "demo@bookkit.test",
  hostName: "Dana Demo",
  timezone: "America/Chicago",
  free: "intro-call",
  questions: "strategy-call",
  paid: "paid-consult",
  inactive: "archived-call",
  multiDuration: "multi-duration",
  cutoff: "cutoff-call",
  secret: "secret-call",
  brand: "e2e-brand",
  brandName: "E2E Brand",
};

export async function seedE2E(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Booking", "MeetingType", "Brand", "Schedule", "Host", "Setting", "SingleUseLink" RESTART IDENTITY CASCADE'
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

  const brand = await prisma.brand.create({
    data: {
      hostId: host.id,
      slug: E2E.brand,
      name: E2E.brandName,
      tagline: "Booked by robots, for now.",
      accentColor: "#FF6A00",
    },
  });

  const common = {
    hostId: host.id,
    durationMinutes: 30,
    currency: "usd",
    weeklyHours: ALL_WEEK as object,
    daysInAdvance: 30,
    minNoticeMinutes: 0,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
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
        brandId: brand.id,
      },
      {
        ...common,
        slug: E2E.questions,
        name: "Strategy call",
        description: "Bring a problem, leave with a plan.",
        color: "#4F8DFD",
        displayMode: "inline",
        brandId: brand.id,
        allowGuests: true,
        maxGuests: 5,
        locations: [{ kind: "google_meet" }, { kind: "phone_invitee" }] as object,
        questions: [
          { id: "q1", label: "What are you building?", type: "long_text", required: true },
          { id: "q2", label: "Anything else?", type: "short_text", required: false },
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
      {
        ...common,
        slug: E2E.multiDuration,
        name: "Multi duration call",
        description: "Pick 30 or 60 minutes.",
        color: "#A855F7",
        durationOptions: [{ minutes: 60, priceCents: null }] as object,
      },
      {
        ...common,
        slug: E2E.cutoff,
        name: "Cutoff call",
        description: "Cannot be changed close to the start time.",
        color: "#EF4444",
        cancelCutoffHours: 999_999,
      },
      {
        ...common,
        slug: E2E.secret,
        name: "Secret call",
        description: "Bookable by direct link only.",
        color: "#111111",
        secret: true,
        brandId: brand.id,
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
