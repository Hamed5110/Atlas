import { test, expect } from "@playwright/test";

test.describe("Login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("valid login reaches dashboard shell", async ({ page }) => {
    const password = process.env.AIRFARE_BOOTSTRAP_ADMIN_PASSWORD || "StrongPassword!2026";
    await page.goto("/");
    await page.fill("#username", "admin");
    await page.fill("#password", password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator(".shell")).toBeVisible();
    await expect(page.locator("#topbar-title")).toHaveText("Dashboard");
  });

  test("invalid password shows error", async ({ page }) => {
    await page.goto("/");
    await page.fill("#username", "admin");
    await page.fill("#password", "WrongPassword!2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator(".error, [role='alert']").first()).toBeVisible();
  });
});
