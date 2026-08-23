import { test, expect } from "../fixtures/auth";

const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
] as const;

for (const viewport of viewports) {
  test(`dashboard layout ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.locator(".shell")).toBeVisible();
    await expect(page.locator("#topbar-title")).toHaveText("Dashboard");
    await expect(page).toHaveScreenshot(`dashboard-${viewport.name}.png`, {
      maxDiffPixelRatio: 0.01,
    });
  });
}
