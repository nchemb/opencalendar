import { expect, test } from "./fixtures";
import { E2E } from "./seed-e2e";
import { E2E_ADMIN_PASSWORD } from "./env";
import { adminNavigate, db, fillDetails, loginAsAdmin, pickFirstSlot } from "./helpers";

test.describe("admin dashboard", () => {
  test("the dashboard is behind the password", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "BookKit admin" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Meeting types" })).toHaveCount(0);
  });

  test("a wrong password does not get in", async ({ page }) => {
    await page.goto("/admin");
    await page.locator("#pw").fill("not-the-password");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByText(/incorrect password/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Meeting types" })).toHaveCount(0);
  });

  test("the right password gets in, and logging out closes it again", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByRole("link", { name: "Meeting types" })).toBeVisible();

    await page.getByRole("button", { name: /log out|sign out/i }).click();
    await expect(page.getByRole("heading", { name: "BookKit admin" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("a new meeting type can be created and is immediately bookable", async ({ page }) => {
    await loginAsAdmin(page);
    await adminNavigate(page, "Meeting types");

    await page.getByRole("button", { name: "New meeting type" }).click();
    await expect(page.getByRole("heading", { name: "New meeting type" })).toBeVisible();

    const slug = `e2e-created-${Date.now().toString(36)}`;
    await page.getByLabel("Name", { exact: true }).fill("Created by a test");
    await page.getByLabel("Slug (URL)", { exact: true }).fill(slug);

    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect
      .poll(async () => db.meetingType.count({ where: { slug } }), { timeout: 20_000 })
      .toBe(1);

    // And a visitor can reach it straight away.
    const res = await page.goto(`/${slug}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Created by a test" })).toBeVisible();
  });

  test("bookings made on the public page show up in the dashboard", async ({ page }) => {
    await page.goto(`/${E2E.free}`);
    await pickFirstSlot(page);
    await fillDetails(page, { name: "Katherine Johnson", email: "e2e-admin-list@example.test" });
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/success\?booking=/, { timeout: 20_000 });

    await loginAsAdmin(page);
    await adminNavigate(page, "Bookings");

    await expect(page.getByText("e2e-admin-list@example.test")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Katherine Johnson")).toBeVisible();
  });

  test("an anonymous POST to an admin API is refused", async ({ request }) => {
    const res = await request.post("/api/admin/meeting-types", {
      data: { slug: "sneaky", name: "Sneaky", durationMinutes: 30 },
    });
    expect(res.status()).toBe(401);
    expect(await db.meetingType.count({ where: { slug: "sneaky" } })).toBe(0);
  });

  test("the login endpoint refuses a wrong password over the API too", async ({ request }) => {
    const bad = await request.post("/api/admin/session", { data: { password: "wrong" } });
    expect(bad.status()).toBe(401);

    const good = await request.post("/api/admin/session", {
      data: { password: E2E_ADMIN_PASSWORD },
    });
    expect(good.status()).toBe(200);
  });
});
