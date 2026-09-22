/**
 * The hosted demo instance.
 *
 * Demo mode (BOOKKIT_DEMO_MODE=1) swaps in the in-memory calendar and refuses
 * paid bookings, so a stranger can book freely without touching anyone's real
 * calendar or any real card. Bookings still land in Postgres, though, so slots
 * would fill up over a few days — hence the reset below.
 */
import { prisma } from "./db";

export const DEMO_HOST_EMAIL = "demo@bookkit.example";

/** Every day 09:00–17:00, so a visitor always finds a slot within a day or two. */
const DEMO_HOURS = Object.fromEntries(
  ["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "09:00", end: "17:00" }]])
);

const DEMO_TYPES = [
  {
    slug: "intro-call",
    name: "Intro call",
    description: "A free 30 minutes. This is the everyday case — pick a time and book it.",
    durationMinutes: 30,
    priceCents: null,
    color: "#FF6A00",
    displayMode: "popup" as const,
    questions: null,
  },
  {
    slug: "strategy-call",
    name: "Strategy call",
    description: "Shows the booking form asking its own questions before confirming.",
    durationMinutes: 45,
    priceCents: null,
    color: "#4F8DFD",
    displayMode: "inline" as const,
    questions: [
      { label: "What are you working on?", required: true },
      { label: "Anything I should read first?", required: false },
    ],
  },
  {
    slug: "paid-consult",
    name: "Paid consult",
    description:
      "A priced meeting type. Checkout is disabled on the demo — self-host it with your own Stripe keys to take payments.",
    durationMinutes: 60,
    priceCents: 6900,
    color: "#22C55E",
    displayMode: "popup" as const,
    questions: null,
  },
];

/**
 * Wipes bookings and restores the demo host and meeting types. Idempotent, and
 * safe to run against a live demo — it only ever touches demo data.
 */
export async function resetDemoData(): Promise<{ host: string; meetingTypes: number }> {
  await prisma.booking.deleteMany({});

  const host = await prisma.host.upsert({
    where: { email: DEMO_HOST_EMAIL },
    update: { googleAuthError: null },
    create: {
      email: DEMO_HOST_EMAIL,
      displayName: "BookKit Demo",
      timezone: "America/Chicago",
      // Demo mode never calls Google, but a host still has to look connected.
      googleRefreshToken: "demo-instance-no-google",
      googleConnectedAt: new Date(),
    },
  });

  const brand = await prisma.brand.upsert({
    where: { slug: "demo" },
    update: {},
    create: { hostId: host.id, slug: "demo", name: "BookKit Demo", tagline: "Book a fake meeting. Resets daily.", accentColor: "#FF6A00" },
  });

  for (const type of DEMO_TYPES) {
    const data = {
      hostId: host.id,
      name: type.name,
      description: type.description,
      durationMinutes: type.durationMinutes,
      priceCents: type.priceCents,
      currency: "usd",
      color: type.color,
      weeklyHours: DEMO_HOURS as object,
      daysInAdvance: 21,
      minNoticeMinutes: 60,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      dailyLimit: null,
      reminderMinutes: [],
      brandId: brand.id,
      questions: (type.questions ?? undefined) as object | undefined,
      displayMode: type.displayMode,
      active: true,
    };

    await prisma.meetingType.upsert({
      where: { slug: type.slug },
      update: data,
      create: { ...data, slug: type.slug },
    });
  }

  return { host: host.email, meetingTypes: DEMO_TYPES.length };
}
