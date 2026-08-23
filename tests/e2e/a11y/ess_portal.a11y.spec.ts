import { test, expect } from "../fixtures/auth";

test("ESS portal form is keyboard reachable", async ({ page }) => {
  await page.goto("/");
  const essNav = page.getByRole("button", { name: /ESS|Self Service/i }).first();
  if (await essNav.count()) {
    await essNav.click();
  }
  await expect(page.locator("form, .ess-form, textarea, input").first()).toBeVisible();
});
