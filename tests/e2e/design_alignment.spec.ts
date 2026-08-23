import { test, expect } from "@playwright/test";

test("primary actions use consistent button classes", async ({ page }) => {
  await page.goto("/");
  const buttons = page.locator("button.primary, button.btn-primary, .button-primary");
  await expect(buttons.first()).toBeVisible();
});

test("forms expose labels and error region", async ({ page }) => {
  await page.goto("/");
  await page.fill("#username", "");
  await page.fill("#password", "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".error, [role='alert'], .toast-error").first()).toBeVisible();
});
