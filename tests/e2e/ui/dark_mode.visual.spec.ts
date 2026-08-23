import { test, expect } from "../fixtures/auth";

test("dark mode toggle preserves contrast", async ({ page }) => {
  await page.goto("/");
  const toggle = page.locator("#theme-toggle").first();
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator("body.dark")).toBeVisible();
  await expect(page.locator(".shell")).toBeVisible();
  await expect(page).toHaveScreenshot("dark-mode.png", { maxDiffPixelRatio: 0.02 });
});
