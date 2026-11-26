import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * HCM :3389 only — continuous entitlement reconciliation UI lives under AI Insights
 * as a migration-debug panel (legacy ATLAS :3355 is retired for this product path).
 */
test("admin can open continuous airfare entitlement reconciliation on :3389", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await signIn(page);
  await page.goto("/ai-insights/", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("ai-insights-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("btn-smart-baseline")).toBeVisible();

  const panel = page.getByTestId("airfare-entitlement-reconciliation");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId("reconciliation-title")).toContainText(/Airfare Entitlement/i);
  await expect(panel.getByTestId("reconciliation-subtitle")).toContainText(/Continuous Entitlement/i);
  await expect(panel.getByTestId("legacy-balance")).toBeVisible();
  await expect(panel.getByTestId("continuous-balance")).toBeVisible();

  await panel.getByTestId("btn-run-reconciliation").click();
  await expect(panel.getByTestId("reconciliation-results")).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId("result-checked")).toBeVisible();

  expect(consoleErrors.filter((entry) => /airfare|entitlement|reconciliation/i.test(entry))).toEqual([]);
});
