import { expect, test } from "./fixtures";
import { E2E } from "./seed-e2e";
import { db, serveHostPage } from "./helpers";

/**
 * The embed is what a customer actually installs, so these run against a fake
 * customer page that loads widget.js the way the README tells people to.
 */
test.describe("widget.js", () => {
  test("an inline embed mounts an iframe and is sized by the child", async ({ page }) => {
    await serveHostPage(
      page,
      `<div id="target" data-bookkit="${E2E.questions}" data-theme="dark"></div>`
    );

    const frame = page.locator("#target iframe.bookkit-inline");
    await expect(frame).toBeVisible({ timeout: 20_000 });
    await expect(frame).toHaveAttribute("src", new RegExp(`/embed/${E2E.questions}`));

    // bookkit.resize drives the height, so the host page never needs a scrollbar
    // inside the iframe.
    await expect
      .poll(async () => Number((await frame.getAttribute("style"))?.match(/height:\s*(\d+)px/)?.[1] ?? 0), {
        timeout: 20_000,
      })
      .toBeGreaterThan(320);
  });

  test("theme and primary colour reach the embed URL", async ({ page }) => {
    await serveHostPage(
      page,
      `<div data-bookkit="${E2E.free}" data-theme="light" data-primary-color="#00AAFF"></div>`
    );

    const frame = page.locator("iframe.bookkit-inline");
    await expect(frame).toBeVisible({ timeout: 20_000 });
    const src = await frame.getAttribute("src");
    expect(src).toContain("theme=light");
    expect(src).toContain("primaryColor=00AAFF");
  });

  test("a popup opens, emits events, and closes on Escape", async ({ page }) => {
    await serveHostPage(
      page,
      `<button data-bookkit-popup="${E2E.free}">Book a call</button>
       <div id="log"></div>
       <script>
         window.addEventListener("bookkit.closed", function () {
           document.getElementById("log").textContent += "closed ";
         });
       </script>`
    );

    await page.getByRole("button", { name: "Book a call" }).click();

    const modal = page.locator(".bookkit-modal");
    await expect(modal).toBeVisible({ timeout: 20_000 });
    await expect(modal.locator("iframe")).toHaveAttribute(
      "src",
      new RegExp(`/embed/${E2E.free}`)
    );

    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden({ timeout: 10_000 });
    await expect(page.locator("#log")).toContainText("closed");
  });

  test("the host page is told when a time is selected and when a booking lands", async ({ page }) => {
    await serveHostPage(
      page,
      `<div data-bookkit="${E2E.free}"></div>
       <div id="log"></div>
       <script>
         ["bookkit.time_selected", "bookkit.booked"].forEach(function (t) {
           window.addEventListener(t, function () {
             document.getElementById("log").textContent += t + " ";
           });
         });
       </script>`
    );

    const frame = page.frameLocator("iframe.bookkit-inline");

    const day = frame.locator('[data-testid="bk-day"][data-open="1"]').first();
    await expect(day).toBeVisible({ timeout: 20_000 });
    await day.click();

    await frame.locator('[data-testid="bk-slot"]').first().click();
    await expect(page.locator("#log")).toContainText("bookkit.time_selected", { timeout: 10_000 });

    await frame.locator("#bk-name").fill("Grace Hopper");
    await frame.locator("#bk-email").fill("e2e-embed@example.test");
    await page.waitForTimeout(1700); // clear the bot filter
    await frame.getByRole("button", { name: "Confirm booking" }).click();

    // Inside an embed the confirmation renders in place rather than navigating.
    await expect(frame.locator('[data-testid="bk-confirmed"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#log")).toContainText("bookkit.booked", { timeout: 10_000 });

    const booking = await db.booking.findFirstOrThrow({
      where: { email: "e2e-embed@example.test" },
    });
    expect(booking.status).toBe("CONFIRMED");
  });

  test("a plain iframe works with no script at all", async ({ page }) => {
    await page.goto(`/embed/${E2E.free}?theme=light&hideHeader=1`);
    await expect(page.locator('[data-testid="bk-day"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-theme='light']")).toBeVisible();
  });

  test("the light theme is actually readable", async ({ page }) => {
    // Regression: <html> is data-theme="dark", so a light subtree redefined the
    // tokens but kept inheriting body's near-white color. Headings and slot
    // buttons rendered white-on-white; only elements that set a colour class
    // explicitly survived.
    await page.goto(`/embed/${E2E.free}?theme=light`);
    await page.locator('[data-testid="bk-day"][data-open="1"]').first().click();
    await expect(page.locator('[data-testid="bk-slot"]').first()).toBeVisible();

    /** Rough perceived lightness, 0 (black) to 255 (white). */
    const luminance = (rgb: string) => {
      const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };

    for (const target of ['[data-testid="bk-slot"]', "h1, h2"]) {
      const color = await page
        .locator(target)
        .first()
        .evaluate((el) => getComputedStyle(el).color);
      expect(luminance(color), `${target} is ${color} on a light background`).toBeLessThan(140);
    }
  });

  test("the embed page is marked noindex", async ({ page }) => {
    await page.goto(`/embed/${E2E.free}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/
    );
  });
});
