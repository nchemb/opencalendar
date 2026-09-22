/**
 * Per-file integration setup. Imported before any app module so the Prisma
 * client is built against the test database.
 */
import "./test-env";

import { afterAll, beforeEach } from "vitest";
import { assertNoLiveCredentials, scrubEnv } from "./test-env";
import { prisma } from "../../lib/db";
import { memoryCalendarControl } from "../../lib/calendar-memory";

beforeEach(async () => {
  // Vitest re-applies .env per test file, so scrub here rather than only at
  // import time — this is the last write before the test body runs.
  scrubEnv();
  assertNoLiveCredentials();

  // Order does not matter under CASCADE, but naming every table keeps a new
  // model from silently leaking state between tests.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Booking", "BookingEvent", "Job", "Alert", "SingleUseLink", "MeetingType", "Schedule", "Brand", "WebhookEndpoint", "ApiKey", "AnalyticsDaily", "Host", "Setting" RESTART IDENTITY CASCADE'
  );
  memoryCalendarControl.reset();
});

afterAll(async () => {
  await prisma.$disconnect();
});
