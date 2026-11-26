import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("ATLAS HCM — E2E screen matrix", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  const screens: Array<{ path: string; heading: RegExp }> = [
    { path: "/dashboard/", heading: /Dashboard|Overview|Command/i },
    { path: "/allocation/", heading: /Airfare Allocation|Allocation/i },
    { path: "/employees/", heading: /Employees|Employee/i },
    { path: "/opening-balances/", heading: /Opening Balance/i },
    { path: "/loans/", heading: /Loan/i },
    { path: "/ess/", heading: /ESS|Request/i },
    { path: "/rates/", heading: /Entitlement Rates/i },
    { path: "/reports/", heading: /Reports/i },
    { path: "/ai-insights/", heading: /AI Insights/i },
    { path: "/offer-letters/", heading: /Offer Letters/i },
    { path: "/contracts/", heading: /Employment Contracts/i },
    { path: "/settings/", heading: /Settings/i },
    { path: "/lookups/", heading: /Lookups/i },
    { path: "/users/", heading: /Users & Access/i },
    { path: "/audit/", heading: /Audit Log/i },
    { path: "/backups/", heading: /Backup/i },
    { path: "/entitlement/accounts/", heading: /Entitlement|Account/i },
    { path: "/entitlement/rules/", heading: /Rule|Entitlement/i },
    { path: "/entitlement/reconcile/", heading: /Reconcile|Reconciliation/i },
    { path: "/entitlement/payroll-export/", heading: /Payroll|Export/i },
  ];

  for (const screen of screens) {
    test(`loads ${screen.path}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      await page.goto(screen.path, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading").first()).toBeVisible();
      await expect(page.getByRole("heading").filter({ hasText: screen.heading }).first()).toBeVisible({
        timeout: 25_000,
      });
      expect(errors, `page errors on ${screen.path}`).toEqual([]);
    });
  }
});
