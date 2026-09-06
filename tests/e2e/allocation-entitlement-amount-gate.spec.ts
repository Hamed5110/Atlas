import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { signIn } from "./helpers";

const authSeedPath = process.env.ATLAS_E2E_AUTH_SEED || "tests/e2e/.auth.json";

function loadToken(): string {
  const seed = JSON.parse(readFileSync(authSeedPath, "utf8")) as { access_token?: string };
  if (!seed.access_token) throw new Error("Auth seed missing — run write_e2e_auth_seed.py");
  return seed.access_token;
}

/**
 * Playwright E2E — Airfare Allocation settlement gates.
 * Tool choice (from research): Playwright for Next.js App Router E2E;
 * pytest/httpx covers Postman-style API contracts separately.
 */
test.describe("Allocation settlement — entitlement amount gate", () => {
  test("disables Entitlement amount when calculated entitlement is zero", async ({
    page,
    request,
  }) => {
    const token = loadToken();
    await signIn(page);
    await page.goto("/allocation/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("airfare-allocation-page")).toBeVisible({ timeout: 30_000 });

    const employees = await request.get("/v1/employees?limit=500", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(employees.ok()).toBeTruthy();
    const list = (await employees.json()) as Array<{ id: string; code: string; full_name: string }>;
    const emp = list.find((e) => e.code === "0008") ?? list[0];
    expect(emp).toBeTruthy();

    const preview = await request.post("/v1/allocations/preview", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        employee_id: emp.id,
        as_of_date: new Date().toISOString().slice(0, 10),
        requested_ticket_amount: 200,
        excess_option: "ENTITLEMENT_AMOUNT",
      },
    });
    expect(preview.ok()).toBeTruthy();
    const previewBody = await preview.json();
    const entitlement = Number(previewBody.final_entitlement_amount ?? 0);

    const employeeBox = page.getByTestId("select-employee");
    await employeeBox.click();
    await employeeBox.fill(emp.code);
    await page.getByRole("option").filter({ hasText: emp.code }).first().click();

    await page.getByTestId("input-ticket-amount").fill("200");
    const origin = page.getByTestId("input-origin");
    await origin.click();
    await origin.fill("BOM");
    const originOpt = page.getByRole("option").filter({ hasText: /BOM/i }).first();
    if (await originOpt.isVisible().catch(() => false)) {
      await originOpt.click();
    }
    const dest = page.getByTestId("input-destination");
    await dest.click();
    await dest.fill("BLR");
    const destOpt = page.getByRole("option").filter({ hasText: /BLR/i }).first();
    if (await destOpt.isVisible().catch(() => false)) {
      await destOpt.click();
    }

    await page.getByTestId("btn-calculate-entitlement").click();
    await expect(page.getByTestId("panel-settlement")).toBeVisible({ timeout: 30_000 });

    const option = page.getByTestId("settlement-option-ENTITLEMENT_AMOUNT");
    await expect(option).toBeVisible();

    if (entitlement <= 0) {
      await expect(option).toBeDisabled();
      await expect(option).toContainText(/Unavailable|no entitlement/i);
      await expect(page.getByTestId("settlement-option-SELF_PAID")).toBeEnabled();
      await expect(page.getByTestId("settlement-option-COMPANY_PAID")).toBeEnabled();
      await expect(page.getByTestId("settlement-option-CONVERT_TO_LOAN")).toBeEnabled();
    } else {
      await expect(option).toBeEnabled();
      test.info().annotations.push({
        type: "note",
        description: `Employee ${emp.code} has entitlement ${entitlement}; enabled path verified.`,
      });
    }
  });
});

test("API rejects ENTITLEMENT_AMOUNT issue when entitlement is zero", async ({ request }) => {
  const token = loadToken();
  const employees = await request.get("/v1/employees?limit=500", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const list = (await employees.json()) as Array<{ id: string; code: string }>;
  const emp = list.find((e) => e.code === "0008");
  test.skip(!emp, "employee 0008 missing");

  const preview = await request.post("/v1/allocations/preview", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      employee_id: emp!.id,
      as_of_date: new Date().toISOString().slice(0, 10),
      requested_ticket_amount: 200,
      excess_option: "ENTITLEMENT_AMOUNT",
    },
  });
  const body = await preview.json();
  const entitlement = Number(body.final_entitlement_amount ?? 0);
  test.skip(entitlement > 0, `entitlement ${entitlement} — zero-gate not exercisable today`);

  const issue = await request.post("/v1/allocations/issue", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      employee_id: emp!.id,
      as_of_date: new Date().toISOString().slice(0, 10),
      requested_ticket_amount: 200,
      excess_option: "ENTITLEMENT_AMOUNT",
      origin_code: "BOM",
      destination_code: "BLR",
      notes: "playwright entitlement gate",
    },
  });
  expect([400, 409, 422]).toContain(issue.status());
  expect(JSON.stringify(await issue.json()).toLowerCase()).toContain("entitlement");
});
