import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("multi-company scope control exists on reconciliation panel", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("nav-ai-insights").click();
  await expect(page.getByTestId("select-company-scope")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("select-company-scope")).toContainText(/All companies/i);
});
