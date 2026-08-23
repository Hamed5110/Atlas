import { test, expect } from "../fixtures/auth";

test("dashboard landmarks are present", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".shell")).toBeVisible();
  await expect(page.locator("nav, .sidebar, #sidebar").first()).toBeVisible();
  await expect(page.locator("main, .main, #main-content").first()).toBeVisible();
});
