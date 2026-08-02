import { expect, test } from "@playwright/test";

const baseUrl = process.env.ATLAS_E2E_BASE_URL || "http://127.0.0.1:3355";
const username = process.env.ATLAS_E2E_USERNAME || "admin";
const password = process.env.ATLAS_E2E_PASSWORD || "admin123456";

test("admin can open continuous airfare entitlement reconciliation when flags are enabled", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const signedInBanner = page.getByText(/Signed in/i);
  if (!(await signedInBanner.isVisible().catch(() => false))) {
    const loginForm = page.locator("form.auth-form");
    await expect(loginForm).toBeVisible({ timeout: 30000 });
    await loginForm.locator('input:not([type="checkbox"])').first().fill(username);
    await loginForm.locator('input[type="password"]').fill(password);
    await loginForm.getByRole("button", { name: /login|sign in/i }).click();
  }
  await expect(page.getByRole("heading", { name: /Airfare Command Center/i })).toBeVisible({ timeout: 30000 });

  await page.getByText(/AI Insights/i).click();
  const panel = page.getByTestId("airfare-entitlement-reconciliation");
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(panel.getByText(/Airfare Entitlement - Migration Debug/i)).toBeVisible();
  await expect(panel.getByText(/Continuous Entitlement Reconciliation - not used for payroll/i)).toBeVisible();
  await expect(panel.getByText(/Legacy Airfare Balance/i)).toBeVisible();
  await expect(panel.getByText(/Continuous Airfare Balance/i)).toBeVisible();
  await panel.getByLabel(/Company scope/i).selectOption("");

  await panel.getByRole("button", { name: /Run reconciliation/i }).click();
  await expect(panel.getByText(/Checked|OK|Investigate|Missing seed/i).first()).toBeVisible({ timeout: 30000 });
  await expect(panel.getByText(/Difference/i).first()).toBeVisible();

  expect(consoleErrors.filter((entry) => /airfare|entitlement|reconciliation/i.test(entry))).toEqual([]);
});
