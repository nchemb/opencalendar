import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { E2E } from "./seed-e2e";
import { db, fillDetails, pickFirstSlot } from "./helpers";

test.describe("single-use link", () => {
  test("books once, then refuses a second use", async ({ page }) => {
    const type = await db.meetingType.findUniqueOrThrow({ where: { slug: E2E.free } });
    const token = randomUUID();
    await db.singleUseLink.create({ data: { token, meetingTypeId: type.id, label: "e2e" } });

    await page.goto(`/${E2E.free}?link=${token}`);
    await pickFirstSlot(page);
    await fillDetails(page, { email: "e2e-single-use@example.test" });
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/success\?booking=/, { timeout: 20_000 });

    const link = await db.singleUseLink.findUniqueOrThrow({ where: { token } });
    expect(link.usedAt).not.toBeNull();
    expect(link.bookingId).not.toBeNull();

    // Second visit with the same token: the calendar never loads, an error shows instead.
    await page.goto(`/${E2E.free}?link=${token}`);
    await expect(page.getByText(/this one-time booking link has already been used/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="bk-day"][data-open="1"]')).toHaveCount(0);

    expect(await db.booking.count({ where: { singleUseLinkId: link.id } })).toBe(1);
  });
});
