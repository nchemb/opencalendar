import { expect, test } from "./fixtures";
import { E2E } from "./seed-e2e";
import { db, fillDetails, pickFirstSlot } from "./helpers";

/** Books through the UI and hands back the row, including its cancel token. */
async function bookOne(page: import("@playwright/test").Page, email: string) {
  await page.goto(`/${E2E.free}`);
  await pickFirstSlot(page);
  await fillDetails(page, { email });
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await page.waitForURL(/\/success\?booking=/, { timeout: 20_000 });
  return db.booking.findFirstOrThrow({ where: { email } });
}

test.describe("cancellation", () => {
  test("the cancel link in the invite cancels the booking", async ({ page }) => {
    const booking = await bookOne(page, "e2e-cancel@example.test");

    await page.goto(`/cancel/${booking.cancelToken}`);
    await expect(page.getByRole("heading", { name: "Cancel this booking?" })).toBeVisible();

    await page.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible({
      timeout: 20_000,
    });

    const cancelled = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  test("the freed time becomes bookable again", async ({ page }) => {
    const booking = await bookOne(page, "e2e-refree@example.test");
    const iso = booking.startTime.toISOString();

    await page.goto(`/cancel/${booking.cancelToken}`);
    await page.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible({
      timeout: 20_000,
    });

    await page.goto(`/${E2E.free}`);
    await page.locator('[data-testid="bk-day"][data-open="1"]').first().click();
    await expect(page.locator('[data-testid="bk-slot"]').first()).toBeVisible();
    await expect(page.locator(`[data-testid="bk-slot"][data-slot="${iso}"]`)).toHaveCount(1);
  });

  test("revisiting the link after cancelling is idempotent", async ({ page }) => {
    const booking = await bookOne(page, "e2e-twice@example.test");

    await page.goto(`/cancel/${booking.cancelToken}`);
    await page.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible({
      timeout: 20_000,
    });
    const cancelledAt = (await db.booking.findUniqueOrThrow({ where: { id: booking.id } }))
      .cancelledAt;

    // A second visit shows the same settled state and offers no way to cancel
    // again, rather than an error.
    await page.goto(`/cancel/${booking.cancelToken}`);
    await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Yes, cancel it" })).toHaveCount(0);

    const after = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.cancelledAt?.toISOString()).toBe(cancelledAt?.toISOString());
  });

  test("a booking that was never confirmed has nothing to cancel", async ({ page }) => {
    const booking = await bookOne(page, "e2e-expired@example.test");
    await db.booking.update({ where: { id: booking.id }, data: { status: "EXPIRED" } });

    await page.goto(`/cancel/${booking.cancelToken}`);
    await expect(page.getByRole("heading", { name: "Nothing to cancel" })).toBeVisible();
  });

  test("an invented token cancels nothing", async ({ page }) => {
    const before = await db.booking.count({ where: { status: "CONFIRMED" } });

    await page.goto("/cancel/definitely-not-a-real-token");
    await expect(page.getByRole("button", { name: "Yes, cancel it" })).toHaveCount(0);

    expect(await db.booking.count({ where: { status: "CONFIRMED" } })).toBe(before);
  });
});
