/**
 * Extra local-only seed data for building/testing the v2 public booking UI:
 * a paid type, a multi-duration type, and a type exercising every question
 * type + multiple locations + guests. Safe to re-run (upserts by slug).
 *
 *   set -a; . ./.env; set +a; npx tsx scripts/dev-seed-v2.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const host = await prisma.host.findFirstOrThrow();
  const schedule = await prisma.schedule.findFirstOrThrow({ where: { hostId: host.id } });
  const brand = await prisma.brand.findFirstOrThrow({ where: { hostId: host.id } });

  await prisma.meetingType.upsert({
    where: { slug: "paid-strategy-call" },
    update: {},
    create: {
      hostId: host.id,
      brandId: brand.id,
      scheduleId: schedule.id,
      slug: "paid-strategy-call",
      name: "Paid strategy call",
      description: "A focused session. **Come with an agenda.**\n\n- What you're working on\n- Where you're stuck\n- What a win looks like\n\nSee [past examples](https://example.com) for how these usually go.",
      durationMinutes: 30,
      durationOptions: [{ minutes: 60, priceCents: 19900 }],
      priceCents: 9900,
      currency: "usd",
      policyText: "Full refund if you cancel more than 24 hours before the call.",
      cancelCutoffHours: 24,
      refundPolicy: "before_cutoff",
    },
  });

  await prisma.meetingType.upsert({
    where: { slug: "everything-call" },
    update: {},
    create: {
      hostId: host.id,
      brandId: brand.id,
      scheduleId: schedule.id,
      slug: "everything-call",
      name: "Everything call",
      description: "Exercises every question type, multiple locations and guests.",
      durationMinutes: 45,
      allowGuests: true,
      maxGuests: 3,
      locations: [
        { kind: "google_meet" },
        { kind: "phone_invitee" },
        { kind: "in_person", value: "123 Main St, Chicago, IL", label: "Office" },
      ],
      questions: [
        { id: "q1", label: "What do you want to cover", type: "short_text", required: true },
        { id: "q2", label: "Background", type: "long_text", required: false },
        { id: "q3", label: "Company size", type: "single_choice", required: true, options: ["Solo", "2-10", "11-50", "50+"] },
        { id: "q4", label: "Interested in", type: "multi_choice", required: false, options: ["Strategy", "Build", "Audit", "Coaching"] },
        { id: "q5", label: "How did you hear about us", type: "dropdown", required: false, options: ["Instagram", "LinkedIn", "Referral", "Other"] },
        { id: "q6", label: "Backup phone", type: "phone", required: false },
      ],
    },
  });

  console.log("seeded: paid-strategy-call, everything-call");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
