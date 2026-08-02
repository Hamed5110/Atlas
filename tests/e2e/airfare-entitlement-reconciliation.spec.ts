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
  await page.getByPlaceholder(/username/i).fill(username);
  await page.getByPlaceholder(/password/i).fill(password);
  await page.getByRole("button", { name: /login|sign in/i }).click();
  await expect(page.getByText(/Airfare Command Center|Signed in/i)).toBeVisible({ timeout: 30000 });

  await page.getByText(/AI Insights/i).click();
  const panel = page.getByTestId("airfare-entitlement-reconciliation");
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(panel.getByText(/Migration Debug \/ Reconciliation - not used for payroll/i)).toBeVisible();
  await expect(panel.getByText(/Legacy Airfare Balance/i)).toBeVisible();
  await expect(panel.getByText(/Continuous Airfare Balance/i)).toBeVisible();
  await expect(panel.getByText(/Difference/i)).toBeVisible();

  await panel.getByRole("button", { name: /Run reconciliation/i }).click();
  await expect(panel.getByText(/Checked|OK|Investigate|Missing seed/i)).toBeVisible({ timeout: 30000 });

  expect(consoleErrors.filter((entry) => /airfare|entitlement|reconciliation/i.test(entry))).toEqual([]);
});
