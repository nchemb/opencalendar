import { expect, test } from "./fixtures";
import { E2E } from "./seed-e2e";
import { db, fillDetails, hasNoHorizontalScroll, pickFirstSlot } from "./helpers";

/** Runs on a phone viewport (see the "mobile" project in playwright.config.ts). */
test.describe("mobile", () => {
  test("the free-booking flow completes on a phone with no horizontal scroll", async ({ page }) => {
    await page.goto(`/${E2E.free}`);
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    await pickFirstSlot(page);
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    await fillDetails(page, { email: "e2e-mobile@example.test" });
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/success\?booking=/, { timeout: 20_000 });
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    const booking = await db.booking.findFirstOrThrow({ where: { email: "e2e-mobile@example.test" } });
    expect(booking.status).toBe("CONFIRMED");
  });

  test("the manage (reschedule/cancel) flow works on a phone with no horizontal scroll", async ({ page }) => {
    await page.goto(`/${E2E.free}`);
    await pickFirstSlot(page);
    await fillDetails(page, { email: "e2e-mobile-manage@example.test" });
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/success\?booking=/, { timeout: 20_000 });

    const booking = await db.booking.findFirstOrThrow({ where: { email: "e2e-mobile-manage@example.test" } });

    await page.goto(`/booking/${booking.cancelToken}`);
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await hasNoHorizontalScroll(page)).toBe(true);
    await page.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible({ timeout: 20_000 });
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    const cancelled = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(cancelled.status).toBe("CANCELLED");
  });

  test("the slot list does not become its own scrollbox when stacked", async ({ page }) => {
    await page.goto(`/${E2E.free}`);
    await page.locator('[data-testid="bk-day"][data-open="1"]').first().click();
    await expect(page.locator('[data-testid="bk-slot"]').first()).toBeVisible();

    const trapped = await page.locator(".bk-scroll").first().evaluate((el) => {
      const style = getComputedStyle(el);
      const scrolls = style.overflowY === "auto" || style.overflowY === "scroll";
      return scrolls && el.scrollHeight > el.clientHeight + 1;
    });

    expect(trapped).toBe(false);
  });
});
