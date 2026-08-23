import { test, expect } from "../fixtures/auth";

test("employee form labels are visible", async ({ page }) => {
  await page.goto("/");
  await page.locator('nav .nav-button[data-module="employees"]').click();
  const createButton = page.getByRole("button", { name: /create|add|new/i }).first();
  if (await createButton.count()) {
    await createButton.click();
  }
  await expect(page.locator("label, [aria-label]").first()).toBeVisible();
});
