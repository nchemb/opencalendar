import assert from "node:assert/strict";
import { expect, test } from "vitest";
import { prisma } from "../../lib/db";
import { createFreeBooking } from "../../lib/booking";
import { memoryCalendarControl } from "../../lib/calendar-memory";
import { bookingInput, createHost, createMeetingType } from "../helpers/factories";

test("the harness talks to a real database", async () => {
  const host = await createHost();
  const found = await prisma.host.findUnique({ where: { id: host.id } });
  assert.equal(found?.email, "host@example.test");
});

test("a free booking confirms and writes one calendar event", async () => {
  const host = await createHost();
  const meetingType = await createMeetingType(host);

  const booking = await createFreeBooking(host, meetingType, bookingInput());

  expect(booking.status).toBe("CONFIRMED");
  expect(booking.googleEventId).toBeTruthy();
  expect(booking.meetLink).toBeTruthy();
  expect(memoryCalendarControl.eventCount()).toBe(1);
});

test("each test starts from a clean database", async () => {
  expect(await prisma.host.count()).toBe(0);
  expect(await prisma.booking.count()).toBe(0);
  expect(memoryCalendarControl.eventCount()).toBe(0);
});
