import { expect, test } from "./fixtures";
import { E2E } from "./seed-e2e";
import { db, fillDetails, pickFirstSlot } from "./helpers";

test.describe("booking page", () => {
  test("a visitor can book a free slot end to end", async ({ page }) => {
    await page.goto(`/${E2E.free}`);
    await expect(page.getByRole("heading", { name: "Intro call" })).toBeVisible();

    const iso = await pickFirstSlot(page);
    await fillDetails(page, { email: "e2e-free@example.test" });
    await page.getByRole("button", { name: "Confirm booking" }).click();

    // The standalone page hands off to /success; the embed renders the card
    // inline instead (covered in embed.spec.ts).
    await page.waitForURL(/\/success\?booking=/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "You're booked" })).toBeVisible({
      timeout: 20_000,
    });

    const booking = await db.booking.findFirstOrThrow({
      where: { email: "e2e-free@example.test" },
    });
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.startTime.toISOString()).toBe(iso);
    expect(booking.googleEventId).toBeTruthy();
    expect(booking.meetLink).toBeTruthy();
  });

  test("a booked time disappears from the picker", async ({ page }) => {
    await page.goto(`/${E2E.free}`);
    const iso = await pickFirstSlot(page);
    await fillDetails(page, { email: "e2e-gone@example.test" });
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/success\?booking=/, { timeout: 20_000 });

    // A fresh visitor must not be offered the same instant.
    await page.goto(`/${E2E.free}`);
    await page.locator('[data-testid="bk-day"][data-open="1"]').first().click();
    await expect(page.locator('[data-testid="bk-slot"]').first()).toBeVisible();
    await expect(page.locator(`[data-testid="bk-slot"][data-slot="${iso}"]`)).toHaveCount(0);
  });

  test("required questions are enforced before the booking is made", async ({ page }) => {
    await page.goto(`/${E2E.questions}`);
    await pickFirstSlot(page);
    await fillDetails(page, { email: "e2e-questions@example.test" });

    // Leave the required question empty — the browser blocks the submit and no
    // navigation happens.
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain(`/${E2E.questions}`);

    await page.fill("#bk-answer-0", "A self-hosted booking tool");
    await page.getByRole("button", { name: "Confirm booking" }).click();

    await page.waitForURL(/\/success\?booking=/, { timeout: 20_000 });

    const booking = await db.booking.findFirstOrThrow({
      where: { email: "e2e-questions@example.test" },
    });
    expect(booking.answers).toEqual([
      { label: "What are you building?", answer: "A self-hosted booking tool" },
    ]);
  });

  test("an unknown meeting type is a 404", async ({ page }) => {
    const res = await page.goto("/no-such-meeting-type");
    expect(res?.status()).toBe(404);
  });

  test("an archived meeting type is not bookable", async ({ page }) => {
    const res = await page.goto(`/${E2E.inactive}`);
    expect(res?.status()).toBe(404);
  });

  test("the page states the host and duration", async ({ page }) => {
    await page.goto(`/${E2E.free}`);
    await expect(page.getByText(E2E.hostName).first()).toBeVisible();
    await expect(page.getByText(/30 min/i).first()).toBeVisible();
  });
});
