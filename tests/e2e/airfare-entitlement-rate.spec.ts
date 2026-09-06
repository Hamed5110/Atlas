import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Phase 1–2 primary entitlement policy = RATE hierarchy (not rule matrix).
 * See docs/ENTITLEMENT_RATE_VS_RULE.md
 */
test.describe("airfare entitlement rates", () => {
  test("rates page shows hierarchy and schedule", async ({ page }) => {
    await signIn(page);
    await page.goto("/rates/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("page-entitlement-rates")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("nav-rates")).toBeVisible();
    await expect(page.getByTestId("rate-hierarchy-card")).toBeVisible();
    await expect(page.getByTestId("badge-scope-employee")).toBeVisible();
    await expect(page.getByTestId("badge-scope-global")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Entitlement Rates/i })).toBeVisible();
  });

  test("new rate form opens with scope and amount fields", async ({ page }) => {
    await signIn(page);
    await page.goto("/rates/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("page-entitlement-rates")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("btn-new-rate").click();
    await expect(page.getByTestId("form-entitlement-rate")).toBeVisible();
    await expect(page.getByTestId("select-rate-scope")).toBeVisible();
    await expect(page.getByTestId("input-rate-amount")).toBeVisible();
    await expect(page.getByTestId("input-rate-effective-from")).toBeVisible();
    await page.getByTestId("btn-cancel-rate").click();
  });

  test("rule matrix is not in primary operations nav", async ({ page }) => {
    await signIn(page);
    await page.goto("/dashboard/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("nav-rates")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("nav-operations").getByTestId("nav-entitlement-rules")).toHaveCount(0);
  });
});
