import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("lookups / companies admin nav is reachable", async ({ page }) => {
  await signIn(page);
  const nav = page.getByTestId("nav-companies");
  await expect(nav).toBeVisible({ timeout: 30_000 });
  await nav.click();
  await expect(page.getByRole("heading", { name: /Lookups/i })).toBeVisible({ timeout: 30_000 });
});
