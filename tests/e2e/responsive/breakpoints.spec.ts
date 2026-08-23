import { test, expect } from "../fixtures/auth";

const breakpoints = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "desktop", width: 1920, height: 1080 },
] as const;

for (const bp of breakpoints) {
  test(`shell adapts at ${bp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.goto("/");
    await expect(page.locator(".shell")).toBeVisible();
    if (bp.width < 768) {
      await expect(page.locator(".sidebar, nav").first()).toBeVisible();
    }
    await expect(page.locator("main, .main, #main-content").first()).toBeVisible();
  });
}
