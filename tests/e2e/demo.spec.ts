import { expect, test } from "./fixtures";
import { E2E } from "./seed-e2e";
import { db, fillDetails, pickFirstSlot } from "./helpers";

test.describe("host paused", () => {
  test("a paused host shows the paused message instead of a calendar", async ({ page }) => {
    const host = await db.host.findUniqueOrThrow({ where: { email: E2E.hostEmail } });
    await db.host.update({
      where: { id: host.id },
      data: { paused: true, pausedMessage: "Taking a short break. Back soon." },
    });
    try {
      await page.goto(`/${E2E.free}`);
      await expect(page.getByText("Taking a short break. Back soon.")).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-testid="bk-day"]')).toHaveCount(0);
    } finally {
      await db.host.update({ where: { id: host.id }, data: { paused: false, pausedMessage: null } });
    }
  });
});

test.describe("demo mode / no payments configured", () => {
  test("a paid meeting type fails gracefully instead of taking a card", async ({ page }) => {
    await page.goto(`/${E2E.paid}`);
    await expect(page.getByRole("heading", { name: "Paid consult" })).toBeVisible();

    await pickFirstSlot(page);
    await fillDetails(page, { email: "e2e-demo-paid@example.test" });
    await page.getByRole("button", { name: /pay .* and book|continue to payment/i }).click();

    // The e2e server runs with no Stripe key at all, same failure surface a
    // self-hoster sees before they configure payments — the booking form shows
    // the error rather than crashing or silently losing the attempt.
    await expect(page.getByText(/payments are not configured on this instance/i)).toBeVisible({
      timeout: 20_000,
    });

    expect(await db.booking.count({ where: { email: "e2e-demo-paid@example.test" } })).toBe(0);
  });
});
