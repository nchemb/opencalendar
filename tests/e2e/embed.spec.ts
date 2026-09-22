import { expect, test } from "./fixtures";
import { E2E } from "./seed-e2e";
import { db, serveHostPage } from "./helpers";

/**
 * The embed is what a customer actually installs, so most of these run against
 * a fake customer page that loads embed.js the way docs/EMBED-PROTOCOL.md tells
 * people to. One test at the end confirms v1 widget.js markup still works.
 */
test.describe("embed.js", () => {
  test("an inline embed mounts an iframe and is sized by the child", async ({ page }) => {
    await serveHostPage(page, `<div id="target" data-bookkit-inline="${E2E.questions}" data-theme="dark"></div>`);

    const frame = page.locator("#target iframe.bk-inline-iframe");
    await expect(frame).toBeVisible({ timeout: 20_000 });
    await expect(frame).toHaveAttribute("src", new RegExp(`/embed/${E2E.questions}`));

    // bookkit:height drives the iframe's own height (ResizeObserver on the child).
    await expect
      .poll(async () => Number((await frame.getAttribute("style"))?.match(/height:\s*(\d+)px/)?.[1] ?? 0), {
        timeout: 20_000,
      })
      .toBeGreaterThan(320);
  });

  test("theme and accent color reach the embed URL", async ({ page }) => {
    await serveHostPage(page, `<div data-bookkit-inline="${E2E.free}" data-theme="light" data-accent="00AAFF"></div>`);

    const frame = page.locator("iframe.bk-inline-iframe");
    await expect(frame).toBeVisible({ timeout: 20_000 });
    const src = await frame.getAttribute("src");
    expect(src).toContain("theme=light");
    expect(src).toContain("accent=00AAFF");
  });

  test("a popup opens, emits events, and closes on Escape", async ({ page }) => {
    await serveHostPage(
      page,
      `<button data-bookkit-popup="${E2E.free}">Book a call</button>
       <div id="log"></div>
       <script>
         window.addEventListener("bookkit:close", function () {
           document.getElementById("log").textContent += "closed ";
         });
       </script>`
    );

    await page.getByRole("button", { name: "Book a call" }).click();

    const modal = page.locator(".bk-modal");
    await expect(modal).toBeVisible({ timeout: 20_000 });
    await expect(modal.locator("iframe")).toHaveAttribute("src", new RegExp(`/embed/${E2E.free}`));

    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden({ timeout: 10_000 });
    await expect(page.locator("#log")).toContainText("closed");
  });

  test("BookKit.open() with a prefill fills name and email, and booking fires bookkit:booked", async ({ page }) => {
    await serveHostPage(
      page,
      `<button id="open-btn">Book a call</button>
       <div id="log"></div>
       <script>
         document.getElementById("open-btn").addEventListener("click", function () {
           window.BookKit.open("${E2E.free}", { prefill: { name: "Ada Lovelace", email: "e2e-embed-open@example.test" } });
         });
         window.addEventListener("bookkit:booked", function (e) {
           document.getElementById("log").textContent += "booked:" + e.detail.email + " ";
         });
       </script>`
    );

    await page.locator("#open-btn").click();
    const frame = page.frameLocator(".bk-modal iframe");

    await expect(frame.locator('[data-testid="bk-day"]').first()).toBeVisible({ timeout: 20_000 });
    await frame.locator('[data-testid="bk-day"][data-open="1"]').first().click();
    await frame.locator('[data-testid="bk-slot"]').first().click();

    await expect(frame.locator("#bk-name")).toHaveValue("Ada Lovelace");
    await expect(frame.locator("#bk-email")).toHaveValue("e2e-embed-open@example.test");

    await page.waitForTimeout(1700); // clear the bot filter
    await frame.getByRole("button", { name: "Confirm booking" }).click();

    await expect(frame.locator('[data-testid="bk-confirmed"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#log")).toContainText("booked:e2e-embed-open@example.test", { timeout: 10_000 });

    const booking = await db.booking.findFirstOrThrow({ where: { email: "e2e-embed-open@example.test" } });
    expect(booking.status).toBe("CONFIRMED");
  });

  test("v1 widget.js markup (data-bookkit) still mounts an inline embed and books", async ({ page }) => {
    await serveHostPage(page, `<div data-bookkit="${E2E.free}"></div>`, { script: "/widget.js" });

    const frame = page.frameLocator("iframe.bookkit-inline");
    await expect(frame.locator('[data-testid="bk-day"]').first()).toBeVisible({ timeout: 20_000 });
    await frame.locator('[data-testid="bk-day"][data-open="1"]').first().click();
    await frame.locator('[data-testid="bk-slot"]').first().click();

    await frame.locator("#bk-name").fill("Grace Hopper");
    await frame.locator("#bk-email").fill("e2e-widget-v1@example.test");
    await page.waitForTimeout(1700);
    await frame.getByRole("button", { name: "Confirm booking" }).click();

    await expect(frame.locator('[data-testid="bk-confirmed"]')).toBeVisible({ timeout: 20_000 });

    const booking = await db.booking.findFirstOrThrow({ where: { email: "e2e-widget-v1@example.test" } });
    expect(booking.status).toBe("CONFIRMED");
  });

  test("a plain iframe works with no script at all", async ({ page }) => {
    await page.goto(`/embed/${E2E.free}?theme=light`);
    await expect(page.locator('[data-testid="bk-day"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-theme='light']")).toBeVisible();
  });

  test("the embed page is marked noindex", async ({ page }) => {
    await page.goto(`/embed/${E2E.free}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});
