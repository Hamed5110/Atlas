import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("payroll export screen is interactive", async ({ page }) => {
  await signIn(page);
  await page.goto("/entitlement/payroll-export/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("page-payroll-export")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("btn-export-to-payroll")).toBeVisible();
  await expect(page.getByTestId("select-payroll-run")).toBeVisible();
  await page.getByTestId("btn-export-to-payroll").click();
  // Wait for any post-click feedback — text-rows-exported or export-success
  await expect(page.getByTestId("text-rows-exported")).toBeVisible({ timeout: 30_000 });
});
