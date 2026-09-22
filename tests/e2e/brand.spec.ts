import { expect, test } from "./fixtures";
import { E2E } from "./seed-e2e";

test.describe("brand profile page", () => {
  test("lists active, non-secret types and hides secret ones", async ({ page }) => {
    await page.goto(`/u/${E2E.brand}`);
    await expect(page.getByRole("heading", { name: E2E.brandName })).toBeVisible();

    await expect(page.getByRole("link", { name: /Intro call/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Strategy call/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Secret call/ })).toHaveCount(0);
  });

  test("an unknown brand is a 404", async ({ page }) => {
    const res = await page.goto("/u/no-such-brand");
    expect(res?.status()).toBe(404);
  });

  test("the OG image route renders a PNG", async ({ request }) => {
    const res = await request.get(`/u/${E2E.brand}/opengraph-image`);
    expect(res.ok()).toBe(true);
    expect(res.headers()["content-type"]).toContain("image/png");
  });
});
