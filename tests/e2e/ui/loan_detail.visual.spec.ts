import { test, expect } from "../fixtures/auth";

test("loan detail panel renders chart area", async ({ page }) => {
  await page.goto("/");
  await page.locator('nav .nav-button[data-module="loans"]').click();
  await expect(page.locator("#topbar-title")).toHaveText("Loans");
  const firstRow = page.locator("table tbody tr, .loan-row").first();
  if (await firstRow.count()) {
    await firstRow.click();
  }
  await expect(page.locator(".loan-detail, .detail-panel, canvas, svg").first()).toBeVisible();
  await expect(page).toHaveScreenshot("loan-detail.png", { maxDiffPixelRatio: 0.01 });
});
