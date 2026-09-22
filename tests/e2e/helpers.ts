import { PrismaClient } from "@prisma/client";
import { expect, type Page } from "@playwright/test";
import { E2E_ADMIN_PASSWORD, E2E_DATABASE_URL } from "./env";

/** Direct database access for asserting on state the UI does not show. */
export const db = new PrismaClient({
  datasources: { db: { url: E2E_DATABASE_URL } },
});

/**
 * Walks the picker: waits for slots to load, opens the first bookable day, and
 * clicks the first free time. Returns the ISO instant that was selected.
 */
export async function pickFirstSlot(page: Page): Promise<string> {
  const openDay = page.locator('[data-testid="bk-day"][data-open="1"]').first();
  await expect(openDay).toBeVisible({ timeout: 20_000 });
  await openDay.click();

  const slot = page.locator('[data-testid="bk-slot"]').first();
  await expect(slot).toBeVisible();
  const iso = await slot.getAttribute("data-slot");
  await slot.click();
  return iso!;
}

/** Fills the details form. `elapsed` exists so the bot filter does not trip. */
export async function fillDetails(
  page: Page,
  { name = "Ada Lovelace", email = "ada@example.test" } = {}
): Promise<void> {
  await expect(page.locator("#bk-name")).toBeVisible();
  await page.fill("#bk-name", name);
  await page.fill("#bk-email", email);
  // The form rejects submissions faster than 1.5s as bot traffic.
  await page.waitForTimeout(1700);
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/admin");
  const password = page.locator("#pw");
  await expect(password).toBeVisible();
  await password.fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();

  // Login triggers a client-side refresh. Wait for the authenticated shell to
  // settle before navigating, or the next goto races it and aborts.
  await expect(page.getByRole("link", { name: "Event types" })).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");
}

/** Follows a dashboard nav link rather than goto(), which races the refresh. */
export async function adminNavigate(page: Page, label: string): Promise<void> {
  await page.getByRole("link", { name: label }).click();
  await page.waitForLoadState("networkidle");
}

/**
 * Serves a fake customer site on the app's own origin, so embed.js (or v1
 * widget.js, via `script`) loads and its postMessage origin check passes
 * without shipping a fixture in public/.
 */
export async function serveHostPage(
  page: Page,
  bodyHtml: string,
  { path = "/__e2e/host", script = "/embed.js" }: { path?: string; script?: string } = {}
): Promise<void> {
  await page.route(`**${path}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><head><meta charset="utf-8">
<title>Customer site</title>
<script src="${script}" defer></script>
</head><body style="margin:0;font-family:system-ui;background:#fff">
<h1>A customer's website</h1>
${bodyHtml}
</body></html>`,
    });
  });
  await page.goto(path);
}

/** True when the document never needs to scroll sideways — the mobile layout's basic contract. */
export async function hasNoHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
