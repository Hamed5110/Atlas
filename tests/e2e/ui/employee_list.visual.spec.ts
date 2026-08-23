import { test, expect } from "../fixtures/auth";

test("employee table layout", async ({ page }) => {
  await page.goto("/");
  await page.locator('nav .nav-button[data-module="employees"]').click();
  await expect(page.locator("#topbar-title")).toHaveText("Employees");
  await expect(page.locator("table.data-table tbody tr").first()).toBeVisible();
  await expect(page).toHaveScreenshot("employee-list.png", { maxDiffPixelRatio: 0.02 });
});
