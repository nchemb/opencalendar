import { expect, test } from "./fixtures";
import { E2E } from "./seed-e2e";
import { db } from "./helpers";

/**
 * Demo mode is what the hosted demo runs on. The guarantee that matters is that
 * it can never reach a real card or a real calendar.
 */
test.describe("demo mode", () => {
  test("a paid meeting type refuses to start checkout", async ({ page, request }) => {
    await page.goto(`/${E2E.paid}`);
    await expect(page.getByRole("heading", { name: "Paid consult" })).toBeVisible();

    const res = await request.post("/api/stripe/intent", {
      data: {
        slug: E2E.paid,
        name: "Ada Lovelace",
        email: "e2e-demo-paid@example.test",
        timezone: "America/New_York",
        startTime: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        elapsedMs: 9000,
      },
    });

    expect(res.ok()).toBe(false);
    expect(await db.booking.count({ where: { email: "e2e-demo-paid@example.test" } })).toBe(0);
  });

  test("no booking ever carries a Stripe payment id on the demo", async () => {
    const paid = await db.booking.count({ where: { NOT: { stripePaymentIntentId: null } } });
    expect(paid).toBe(0);
  });

  test("confirmed bookings get in-memory event ids, never real Google ones", async () => {
    const confirmed = await db.booking.findMany({
      where: { status: "CONFIRMED" },
      select: { googleEventId: true, meetLink: true },
    });

    expect(confirmed.length).toBeGreaterThan(0);
    for (const b of confirmed) {
      expect(b.googleEventId).toMatch(/^mem-evt-/);
      expect(b.meetLink).toContain("meet.example.com");
    }
  });
});
