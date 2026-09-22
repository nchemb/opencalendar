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

  test("every question type, guests, and a non-Meet location are collected, and answers store with their ids", async ({
    page,
  }) => {
    await page.goto(`/${E2E.questions}`);
    await pickFirstSlot(page);
    await fillDetails(page, { name: "Grace Hopper", email: "e2e-questions@example.test" });

    // Required question left empty — the browser's own validation blocks the
    // submit, so no request ever goes out and the page never navigates.
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain(`/${E2E.questions}`);

    // Switch to the non-Meet location, which reveals a required phone field.
    await page.getByRole("radio", { name: /phone call \(host calls you\)/i }).click();
    await page.fill("#bk-inv-phone", "+1 555-0100");

    await page.fill("#bk-q-q1", "A self-hosted booking tool");
    // q2 is optional and deliberately left blank.
    await page.fill("#bk-guests", "guest1@example.test, guest2@example.test");

    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/success\?booking=/, { timeout: 20_000 });

    const booking = await db.booking.findFirstOrThrow({
      where: { email: "e2e-questions@example.test" },
    });
    expect(booking.answers).toEqual([{ id: "q1", label: "What are you building?", answer: "A self-hosted booking tool" }]);
    expect(booking.guests.sort()).toEqual(["guest1@example.test", "guest2@example.test"]);
    expect(booking.location).toMatchObject({ kind: "phone_invitee", value: "+1 555-0100" });
  });

  test("picking a non-default duration books that length", async ({ page }) => {
    await page.goto(`/${E2E.multiDuration}`);
    await page.getByRole("radio", { name: "60 min" }).click();

    await pickFirstSlot(page);
    await fillDetails(page, { email: "e2e-duration@example.test" });
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/success\?booking=/, { timeout: 20_000 });

    const booking = await db.booking.findFirstOrThrow({
      where: { email: "e2e-duration@example.test" },
    });
    const minutes = Math.round((booking.endTime.getTime() - booking.startTime.getTime()) / 60_000);
    expect(minutes).toBe(60);
  });

  test("an unknown meeting type is a 404", async ({ page }) => {
    const res = await page.goto("/no-such-meeting-type");
    expect(res?.status()).toBe(404);
  });

  test("an archived meeting type is not bookable", async ({ page }) => {
    const res = await page.goto(`/${E2E.inactive}`);
    expect(res?.status()).toBe(404);
  });

  test("the page states the host (or brand) and duration", async ({ page }) => {
    // E2E.free is attached to a brand, so the brand name takes over from the host's.
    await page.goto(`/${E2E.free}`);
    await expect(page.getByText(E2E.brandName).first()).toBeVisible();
    await expect(page.getByText(/30 min/i).first()).toBeVisible();

    // A type with no brand falls back to the host's own name.
    await page.goto(`/${E2E.paid}`);
    await expect(page.getByText(E2E.hostName).first()).toBeVisible();
  });
});
