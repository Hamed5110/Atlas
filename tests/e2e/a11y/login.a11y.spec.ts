import { test, expect } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("login form exposes accessible fields", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#username")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
