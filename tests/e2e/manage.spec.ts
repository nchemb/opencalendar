import { expect, test } from "./fixtures";
import { E2E } from "./seed-e2e";
import { db, fillDetails, pickFirstSlot } from "./helpers";

/** Books through the UI and hands back the row, including its manage token. */
async function bookOne(page: import("@playwright/test").Page, slug: string, email: string) {
  await page.goto(`/${slug}`);
  await pickFirstSlot(page);
  await fillDetails(page, { email });
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await page.waitForURL(/\/success\?booking=/, { timeout: 20_000 });
  return db.booking.findFirstOrThrow({ where: { email } });
}

test.describe("manage booking (reschedule / cancel)", () => {
  test("an invitee can reschedule to another slot, then cancel with a reason", async ({ page }) => {
    const booking = await bookOne(page, E2E.free, "e2e-manage@example.test");
    const originalStart = booking.startTime.toISOString();

    await page.goto(`/booking/${booking.cancelToken}`);
    await expect(page.getByRole("heading", { name: "Intro call" })).toBeVisible();
    await page.getByRole("button", { name: "Reschedule" }).click();
    await expect(page.getByRole("heading", { name: "Pick a new time" })).toBeVisible();

    await pickFirstSlot(page);
    await expect(page.getByRole("heading", { name: "Booking moved" })).toBeVisible({ timeout: 20_000 });

    const moved = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(moved.status).toBe("CONFIRMED");
    expect(moved.rescheduleCount).toBe(1);
    expect(moved.startTime.toISOString()).not.toBe(originalStart);

    // Same booking, now cancel it with a reason.
    await page.goto(`/booking/${booking.cancelToken}`);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.fill("#bk-reason", "Plans changed.");
    await page.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible({ timeout: 20_000 });

    const cancelled = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(cancelled.cancelReason).toBe("Plans changed.");
  });

  test("/cancel/<token> redirects to the manage page's cancel panel", async ({ page }) => {
    const booking = await bookOne(page, E2E.free, "e2e-cancel-redirect@example.test");
    await page.goto(`/cancel/${booking.cancelToken}`);
    await expect(page).toHaveURL(new RegExp(`/booking/${booking.cancelToken}\\?action=cancel`));
    await expect(page.getByRole("heading", { name: "Cancel this booking?" })).toBeVisible();
  });

  test("a cutoff-protected booking shows the policy message and offers no cancel button", async ({ page }) => {
    const booking = await bookOne(page, E2E.cutoff, "e2e-cutoff@example.test");

    await page.goto(`/booking/${booking.cancelToken}`);
    await expect(page.getByText(/changes are only possible up to 999999 hours before the meeting/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Reschedule" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
  });
});
