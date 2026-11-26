import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("entitlement reconciliation screen runs", async ({ page }) => {
  await signIn(page);
  await page.goto("/entitlement/reconcile/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("page-entitlement-reconcile")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("btn-run-reconciliation")).toBeVisible();
  await page.getByTestId("btn-run-reconciliation").click();
  // Empty ledger still returns is_balanced=true; wait for either summary or toast.
  await expect(
    page.getByTestId("text-is-balanced").or(page.getByText(/Balanced|Variances found|reconcile/i).first())
  ).toBeVisible({ timeout: 30_000 });
});
