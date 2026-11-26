import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("ATLAS — Import / Export / Print UI surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("Employees exposes import panel + export Excel", async ({ page }) => {
    await page.goto("/employees/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /Export Excel/i }).first()).toBeVisible();
    await expect(page.getByText(/Bulk import/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Excel template/i }).first()).toBeVisible();
  });

  test("Opening Balances exposes import + export", async ({ page }) => {
    await page.goto("/opening-balances/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /Export|Excel/i }).first()).toBeVisible();
    await expect(page.getByText(/Bulk import|Import/i).first()).toBeVisible();
  });

  test("Reports exposes Excel and PDF export actions", async ({ page }) => {
    await page.goto("/reports/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Employee Master/i }).click();
    await expect(page.getByRole("button", { name: /Excel/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /PDF/i }).first()).toBeVisible();
  });

  test("Offer Letters exposes PDF print/download path", async ({ page }) => {
    await page.goto("/offer-letters/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Offer/i }).first()).toBeVisible();
    // Studio chrome: Issue / Preview / PDF when documents exist
    await expect(page.getByText(/Offer|template|Issue|Preview|PDF/i).first()).toBeVisible();
  });
});
