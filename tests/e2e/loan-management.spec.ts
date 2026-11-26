import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("loans page exposes settle and monthly EMI run", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("nav-loans").click();
  await expect(page.getByTestId("loans-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("btn-monthly-emi-run")).toBeVisible();
  await expect(page.getByTestId("btn-new-loan")).toBeVisible();
  const settle = page.locator('[data-testid^="btn-settle-loan-"]');
  if ((await settle.count()) > 0) {
    await expect(settle.first()).toBeVisible();
  }
});
