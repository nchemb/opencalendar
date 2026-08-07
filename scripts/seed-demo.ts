/**
 * Seeds (or re-seeds) a demo instance.
 *
 *   BOOKKIT_DEMO_MODE=1 npx tsx scripts/seed-demo.ts
 *
 * Deletes every booking, so only ever point it at a demo database.
 */
import { resetDemoData } from "../lib/demo";
import { isDemoMode } from "../lib/env";

async function main() {
  if (!isDemoMode()) {
    throw new Error(
      "Refusing to run: BOOKKIT_DEMO_MODE is not 1. This script deletes all bookings."
    );
  }

  const result = await resetDemoData();
  console.log(`demo ready: host ${result.host}, ${result.meetingTypes} meeting types`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../lib/db");
    await prisma.$disconnect();
  });
