/** Frontend: Finance Ledger page + Focus-style Excel/PDF export controls. */

import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("finance ledger shows report and Excel/PDF export buttons", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("nav-finance-ledger").click();
  await expect(page.getByRole("heading", { name: /Finance Ledger/i })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Where is the report/i)).toBeVisible();
  await expect(page.locator("#ledger-report")).toBeVisible();
  await expect(page.getByTestId("finance-export-xlsx")).toBeVisible();
  await expect(page.getByTestId("finance-export-pdf")).toBeVisible();
  await expect(page.getByTestId("finance-account-filter")).toBeVisible();

  const xlsxDownload = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByTestId("finance-export-xlsx").click();
  const xlsx = await xlsxDownload;
  expect(xlsx.suggestedFilename()).toMatch(/finance-ledger-report\.xlsx/i);

  const pdfDownload = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByTestId("finance-export-pdf").click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toMatch(/finance-ledger-report\.pdf/i);
});
