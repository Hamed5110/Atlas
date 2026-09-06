import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("entitlement account viewer loads", async ({ page }) => {
  await signIn(page);
  await page.goto("/entitlement/accounts/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("page-entitlement-accounts")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("card-account-summary")).toBeVisible();
  await expect(page.getByTestId("select-fiscal-year")).toBeVisible();
});
