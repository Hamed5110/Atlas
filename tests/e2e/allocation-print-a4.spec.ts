import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * E2E: Allocation print dialog preview + Download A4 PDF (preview parity).
 */
test.describe("Allocation A4 print", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("preview dialog and PDF download match bilingual slip", async ({ page }) => {
    await page.goto("/allocation/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("airfare-allocation-page")).toBeVisible({ timeout: 30_000 });

    const printBtn = page
      .getByTestId("btn-print-ticket")
      .or(page.getByRole("button", { name: /^Print$/i }))
      .first();
    await expect(printBtn).toBeVisible({ timeout: 30_000 });
    await printBtn.click();

    await expect(page.getByText("Print allocation (A4)")).toBeVisible();
    const preview = page.getByTestId("allocation-print-preview");
    // Fallback if static UI not yet redeployed with testids
    const previewOrDialog = preview.or(page.locator(".allocation-print-a4"));
    await expect(previewOrDialog.first()).toBeVisible();
    await expect(page.getByRole("article").getByRole("heading", { name: /Airfare Allocation/i })).toBeVisible();
    await expect(page.getByRole("article").getByText("تخصيص بدل تذاكر السفر")).toBeVisible();
    await expect(page.getByRole("article").getByText(/Document No/i).first()).toBeVisible();
    await expect(page.getByRole("article").getByText(/Nationality/i).first()).toBeVisible();
    await expect(page.getByRole("article").getByText(/Employee Payable/i).first()).toBeVisible();
    await expect(page.getByRole("article").getByText(/Ticket & entitlement/i).first()).toBeVisible();
    await expect(page.getByRole("article").getByText(/^Balance$/i).first()).toBeVisible();
    // Bilingual status: الحالة: مدفوع (not "الحالة PAID")
    await expect(page.getByRole("article").getByText(/الحالة:\s*مدفوع|الحالة:\s*معتمد|الحالة:/)).toBeVisible();
    // Balance grid headers: English + Arabic
    await expect(page.getByRole("article").getByText("الرصيد").first()).toBeVisible();
    await expect(page.getByRole("article").getByText("المدفوع مسبقاً").first()).toBeVisible();
    await expect(page.getByRole("article").getByText(/Already Paid/i).first()).toBeVisible();

    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    const downloadBtn = page.getByTestId("btn-download-a4-pdf").or(
      page.getByRole("button", { name: /Download A4 PDF/i })
    );
    await downloadBtn.first().click();
    const download = await downloadPromise;
    const name = download.suggestedFilename();
    expect(name.toLowerCase()).toMatch(/\.pdf$/);
    await expect(page.getByText(/Print failed/i)).toHaveCount(0);
  });
});
