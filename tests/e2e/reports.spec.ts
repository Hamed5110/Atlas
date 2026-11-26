import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("reports catalog and native designer load on :3389", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("nav-reports").click();
  await expect(page.getByTestId("reports-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("reports-catalog")).toBeVisible();
  await expect(page.getByTestId("report-designer")).toBeVisible();
  await expect(page.getByText(/Native banded designer/i).first()).toBeVisible();
});

test("airfare payable tile loads grid with year/as-of filters", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("nav-reports").click();
  await expect(page.getByTestId("reports-page")).toBeVisible({ timeout: 30_000 });

  await expect(page.getByTestId("report-tile-airfare-payable")).toBeVisible();
  await expect(page.getByTestId("report-tile-airfare-payable-summary")).toBeVisible();
  await expect(page.getByTestId("report-tile-airfare-payable-exceptions")).toBeVisible();

  await page.getByTestId("report-tile-airfare-payable").click();
  await expect(page.getByTestId("payable-filters")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("payable-year")).toBeVisible();
  await expect(page.getByTestId("payable-asof")).toBeVisible();
  await expect(page.getByTestId("report-export-xlsx")).toBeVisible();
  await expect(page.getByTestId("report-export-pdf")).toBeVisible();

  await expect(page.getByTestId("report-row-count")).toContainText(/\d+ rows/i, {
    timeout: 90_000,
  });

  await page.getByTestId("report-tile-airfare-payable-summary").click();
  await expect(page.getByTestId("report-row-count")).toContainText(/\d+ rows/i, {
    timeout: 90_000,
  });
});
