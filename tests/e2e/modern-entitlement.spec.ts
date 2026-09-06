import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * @critical modern continuous entitlement on :3389 — Rates + Allocation.
 * Period-end / year close is removed from the product path.
 */
test("modern continuous entitlement rates + allocation @critical", async ({ page }) => {
  await signIn(page);

  await page.getByTestId("nav-rates").click();
  await expect(page.getByRole("heading", { name: /Entitlement Rates/i }).first()).toBeVisible({
    timeout: 30_000,
  });

  await page.getByTestId("nav-airfare-allocation").click();
  await expect(page.getByTestId("airfare-allocation-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("select-employee")).toBeVisible();
  await expect(page.getByTestId("btn-calculate-entitlement")).toBeVisible();

  // Period End must not appear in primary navigation.
  await expect(page.getByTestId("nav-entitlement-year-end")).toHaveCount(0);

  const employeeSelect = page.getByTestId("select-employee");
  const options = employeeSelect.locator("option");
  const count = await options.count();
  if (count > 1) {
    const value = await options.nth(1).getAttribute("value");
    if (value) {
      await employeeSelect.selectOption(value);
      await page.getByTestId("btn-calculate-entitlement").click();
      await expect(page.getByTestId("panel-allocation-summary")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("entitlement-preview")).toBeVisible();
    }
  }

  await page.goto("/entitlement/year-end/", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/allocation\/?/i, { timeout: 15_000 });
});
