import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("employee master opens full-screen create form", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("nav-employee-master").click();
  await expect(page.getByTestId("employee-master-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("table-employee-master")).toBeVisible();

  await page.getByTestId("btn-add-employee").click();
  await expect(page.getByTestId("input-employee-id")).toBeVisible();
  await expect(page.getByTestId("input-employee-name")).toBeVisible();
  await expect(page.getByTestId("btn-save-employee")).toBeVisible();
  await expect(page.getByTestId("btn-cancel-employee")).toBeVisible();
  await page.getByTestId("btn-cancel-employee").click();
});
