import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("opening balances screen loads", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("nav-opening-balances").click();
  await expect(page.getByRole("heading", { name: /Opening Balance/i })).toBeVisible({
    timeout: 30_000,
  });
});
