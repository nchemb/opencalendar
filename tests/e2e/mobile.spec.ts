import { expect, test } from "./fixtures";
import { E2E } from "./seed-e2e";
import { db, fillDetails, pickFirstSlot, serveHostPage } from "./helpers";

/**
 * Runs on a phone viewport. The thing worth guarding is the nested-scroll trap:
 * a scrollbox inside an iframe on a touch device swallows the page scroll, so
 * the slot list must flow full height when stacked and only scroll in its own
 * column on wide layouts.
 */
test.describe("mobile", () => {
  test("the booking flow completes on a phone", async ({ page }) => {
    await page.goto(`/${E2E.free}`);
    await pickFirstSlot(page);
    await fillDetails(page, { email: "e2e-mobile@example.test" });
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/success\?booking=/, { timeout: 20_000 });

    const booking = await db.booking.findFirstOrThrow({
      where: { email: "e2e-mobile@example.test" },
    });
    expect(booking.status).toBe("CONFIRMED");
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

  test("the page itself scrolls rather than an inner box", async ({ page }) => {
    await page.goto(`/${E2E.free}`);
    await page.locator('[data-testid="bk-day"][data-open="1"]').first().click();
    await expect(page.locator('[data-testid="bk-slot"]').first()).toBeVisible();

    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.scrollY);

    // Either the page moved, or it genuinely fits on screen — what must not
    // happen is the content being taller than the viewport and stuck.
    const fits = await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight + 1
    );
    expect(after > before || fits).toBe(true);
  });

  test("an inline embed on a phone has no inner scrollbox either", async ({ page }) => {
    await serveHostPage(page, `<div data-bookkit="${E2E.questions}"></div>`);

    const frame = page.frameLocator("iframe.bookkit-inline");
    await expect(frame.locator('[data-testid="bk-day"]').first()).toBeVisible({ timeout: 20_000 });
    await frame.locator('[data-testid="bk-day"][data-open="1"]').first().click();
    await expect(frame.locator('[data-testid="bk-slot"]').first()).toBeVisible();

    const trapped = await frame.locator(".bk-scroll").first().evaluate((el) => {
      const style = getComputedStyle(el);
      const scrolls = style.overflowY === "auto" || style.overflowY === "scroll";
      return scrolls && el.scrollHeight > el.clientHeight + 1;
    });

    expect(trapped).toBe(false);
  });
});
