import { expect, test } from "@playwright/test";

/**
 * P1 smoke — HCM product path is :3389 only (no :3355).
 */
test("build is served on 3389 with data-testid hooks", async ({ page }) => {
  const response = await page.goto("http://127.0.0.1:3389/login/", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByTestId("login-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("login-form")).toBeVisible();
  await expect(page.getByTestId("btn-sign-in")).toBeVisible();
  const html = await page.content();
  expect(html).toContain("data-testid");
  expect(html).not.toContain("vite-error-overlay");
});

test("no stale 3355 server responding", async ({ request }) => {
  let alive = false;
  try {
    const response = await request.get("http://127.0.0.1:3355/", { timeout: 2_000 });
    alive = response.status() > 0;
  } catch {
    alive = false;
  }
  expect(alive).toBeFalsy();
});
