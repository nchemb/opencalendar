/**
 * Generates the README screenshots against the demo seed, so the images always
 * match the current UI.
 *
 *   npx playwright test --project=screenshots
 *
 * Not part of the normal run — it writes files rather than asserting anything.
 */
import { expect, test } from "@playwright/test";
import { E2E } from "./seed-e2e";
import { E2E_ADMIN_PASSWORD } from "./env";
import { serveHostPage } from "./helpers";

const DIR = "docs/screenshots";

test.describe.configure({ mode: "serial" });

// The server runs in demo mode, but the demo banner is not part of the product.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const hide = () => {
      const style = document.createElement("style");
      style.textContent = "[data-bookkit-demo-banner]{display:none !important}";
      document.head.appendChild(style);
    };
    if (document.head) hide();
    else document.addEventListener("DOMContentLoaded", hide);
  });
});

test("booking page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${E2E.questions}`);

  const day = page.locator('[data-testid="bk-day"][data-open="1"]').first();
  await expect(day).toBeVisible({ timeout: 20_000 });
  await day.click();
  await expect(page.locator('[data-testid="bk-slot"]').first()).toBeVisible();

  await page.screenshot({ path: `${DIR}/booking-page.png` });
});

test("booking form", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${E2E.questions}`);

  await page.locator('[data-testid="bk-day"][data-open="1"]').first().click();
  await page.locator('[data-testid="bk-slot"]').first().click();

  await expect(page.locator("#bk-name")).toBeVisible();
  await page.fill("#bk-name", "Ada Lovelace");
  await page.fill("#bk-email", "ada@example.com");
  await page.fill("#bk-q-q1", "A self-hosted booking page for my consultancy.");

  await page.screenshot({ path: `${DIR}/booking-form.png` });
});

test("inline embed on a customer site", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 950 });
  await serveHostPage(
    page,
    `<p style="max-width:60ch;color:#444">The picker below is an inline BookKit embed —
     one script tag and one div, sized to its own content.</p>
     <div data-bookkit-inline="${E2E.free}" data-theme="light" data-accent="4F8DFD"></div>`
  );

  const frame = page.frameLocator("iframe.bk-inline-iframe");
  await expect(frame.locator('[data-testid="bk-day"]').first()).toBeVisible({ timeout: 20_000 });
  await frame.locator('[data-testid="bk-day"][data-open="1"]').first().click();
  await expect(frame.locator('[data-testid="bk-slot"]').first()).toBeVisible();
  await page.waitForTimeout(600); // let the auto-height settle

  await page.screenshot({ path: `${DIR}/inline-embed.png` });
});

test("popup embed", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await serveHostPage(
    page,
    `<p style="max-width:60ch;color:#444">Any element can open the popup.</p>
     <button data-bookkit-popup="${E2E.free}"
       style="font:15px system-ui;padding:11px 18px;border:0;border-radius:9px;background:#FF6A00;color:#0b0b0c;font-weight:600">
       Book a call
     </button>`
  );

  await page.getByRole("button", { name: "Book a call" }).click();
  const modal = page.locator(".bk-modal");
  await expect(modal).toBeVisible({ timeout: 20_000 });

  const frame = page.frameLocator(".bk-modal iframe");
  await expect(frame.locator('[data-testid="bk-day"]').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(600);

  await page.screenshot({ path: `${DIR}/popup-embed.png` });
});

test("admin event types", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin");
  await page.locator("#pw").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("link", { name: "Event types" })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "Event types" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("link", { name: "New event type" })).toBeVisible();

  await page.screenshot({ path: `${DIR}/admin-event-types.png` });
});

test("mobile booking page", async ({ page }) => {
  await page.setViewportSize({ width: 414, height: 900 });
  await page.goto(`/${E2E.free}`);

  const day = page.locator('[data-testid="bk-day"][data-open="1"]').first();
  await expect(day).toBeVisible({ timeout: 20_000 });
  await day.click();
  await expect(page.locator('[data-testid="bk-slot"]').first()).toBeVisible();

  await page.screenshot({ path: `${DIR}/mobile.png`, fullPage: true });
});
