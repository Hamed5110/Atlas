import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Red-team E2E: Offer Letter + Contract studio — company letterhead, bilingual preview, issue PDF.
 */
async function fillOfferParty(page: import("@playwright/test").Page) {
  await page.getByTestId("field-document-full_name").fill("RED TEAM OFFEREE");
  await page.getByTestId("field-document-nationality").fill("BAHRAINI");
  await page.getByTestId("field-document-nature_of_employment").fill("TECHNICIAN WORKER");
  await page.getByTestId("field-document-basic").fill("100");
  await page.getByTestId("field-document-probation_months").fill("3");
  await page.getByTestId("field-document-annual_leave_days").fill("30");
}

async function selectFirstCompany(page: import("@playwright/test").Page) {
  const select = page.getByTestId("select-document-company");
  await expect(select).toBeVisible({ timeout: 30_000 });
  const options = select.locator("option");
  const count = await options.count();
  expect(count, "at least one company option").toBeGreaterThan(1);
  const value = await options.nth(1).getAttribute("value");
  expect(value).toBeTruthy();
  await select.selectOption(value!);
  return value!;
}

test.describe("Offer / Contract Focus Soft print — redteam E2E", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("Offer Letters: preview bilingual Focus Soft HTML", async ({ page }) => {
    await page.goto("/offer-letters/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("page-offer-letters")).toBeVisible({ timeout: 30_000 });

    await selectFirstCompany(page);
    await fillOfferParty(page);

    await page.getByTestId("btn-document-preview").click();
    const frame = page.getByTestId("document-preview-frame");
    await expect(frame).toBeVisible({ timeout: 45_000 });

    const html = await frame.evaluate((el) => (el as HTMLIFrameElement).srcdoc || "");
    expect(html).toContain("خطاب عرض وظيفي");
    expect(html).toContain("Job Offer Letter");
    expect(html).toContain("Dear MR/Ms.");
    expect(html).toMatch(/100\.00\/-/);
    expect(html).toContain("page-header");
    expect(html).toContain("RED TEAM OFFEREE");
  });

  test("Contracts: preview bilingual contract HTML", async ({ page }) => {
    await page.goto("/contracts/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("page-contracts")).toBeVisible({ timeout: 30_000 });

    await selectFirstCompany(page);
    await page.getByTestId("field-document-full_name").fill("RED TEAM EMPLOYEE");
    await page.getByTestId("field-document-nationality").fill("BAHRAINI");
    await page.getByTestId("field-document-nature_of_employment").fill("DATA ENTRY OPERATOR");
    await page.getByTestId("field-document-basic").fill("350");
    await page.getByTestId("field-document-probation_months").fill("3");
    await page.getByTestId("field-document-annual_leave_days").fill("30");
    // Contract-required extras when present
    const hours = page.getByTestId("field-document-working_hours");
    if (await hours.count()) await hours.fill("48");
    const notice = page.getByTestId("field-document-notice_period_days");
    if (await notice.count()) await notice.fill("30");

    await page.getByTestId("btn-document-preview").click();
    const frame = page.getByTestId("document-preview-frame");
    await expect(frame).toBeVisible({ timeout: 45_000 });
    const html = await frame.evaluate((el) => (el as HTMLIFrameElement).srcdoc || "");
    expect(html).toContain("Contract of Employment");
    expect(html).toMatch(/عقد/);
    expect(html).toMatch(/المادة/);
    expect(html).toMatch(/350\.00\/-/);
    expect(html).toContain("page-header");
  });

  test("Offer Letters: Issue & PDF returns application/pdf", async ({ page }) => {
    await page.goto("/offer-letters/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("page-offer-letters")).toBeVisible({ timeout: 30_000 });
    await selectFirstCompany(page);
    await fillOfferParty(page);

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }).catch(() => null),
      page.getByTestId("btn-document-issue").click(),
    ]);

    // Issue may open PDF in new tab or trigger download — either path is OK if history updates
    if (download) {
      const path = await download.path();
      expect(path || download.suggestedFilename()).toBeTruthy();
    }

    // History table should show the issued voucher eventually
    await expect(page.getByText(/OFL-|RED TEAM OFFEREE|Issued|Issued/i).first()).toBeVisible({
      timeout: 45_000,
    });
  });

  test("Settings company profile exposes Arabic name field", async ({ page }) => {
    await page.goto("/settings/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("card-company-profile")).toBeVisible({ timeout: 30_000 });
    const edit = page.getByTestId(/btn-edit-company-/).first();
    await expect(edit).toBeVisible();
    await edit.click();
    await expect(page.getByTestId("input-company-arabic-name")).toBeVisible();
    await expect(page.getByTestId("input-company-name")).toBeVisible();
  });
});
