import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Applitools-style visual regression using Playwright screenshot baselines.
 * Update golden images: `npx playwright test --project=visual --update-snapshots`
 */
const VISUAL_SCREENS = [
  { path: "/dashboard/", name: "dashboard" },
  { path: "/employees/", name: "employees" },
  { path: "/reports/", name: "reports" },
  { path: "/ai-insights/", name: "ai-insights" },
  { path: "/allocation/", name: "allocation" },
] as const;

test.describe("ATLAS — visual baselines", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  for (const screen of VISUAL_SCREENS) {
    test(`visual: ${screen.name}`, async ({ page }) => {
      await page.goto(screen.path, { waitUntil: "networkidle" });
      await page.evaluate(() => {
        const style = document.createElement("style");
        style.textContent = `
          *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
        `;
        document.head.appendChild(style);
      });
      // AI Insights has live charts / timestamps — allow slightly higher churn
      const maxDiffPixelRatio = screen.name === "ai-insights" ? 0.05 : 0.02;
      await expect(page).toHaveScreenshot(`atlas-${screen.name}.png`, {
        fullPage: true,
        animations: "disabled",
        maxDiffPixelRatio,
      });
    });
  }
});
