import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Rule matrix is Phase 3 / advanced only (docs/ENTITLEMENT_RATE_VS_RULE.md).
 * Kept as a smoke that the advanced page still loads — not a primary acceptance gate.
 */
test("advanced rule matrix page remains reachable", async ({ page }) => {
  await signIn(page);
  await page.goto("/entitlement/rules/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("page-entitlement-rules")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("rules-deprecated-banner")).toBeVisible();
});
