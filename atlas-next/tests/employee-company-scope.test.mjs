import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = () => readFileSync(join(root, "app/(app)/employees/page.tsx"), "utf8");

test("Employee Master supports company filter, column, and form picker", () => {
  const src = page();
  assert.match(src, /data-testid="filter-employee-company"/);
  assert.match(src, /data-testid="input-employee-company"/);
  assert.match(src, /<TH>Company<\/TH>/);
  assert.match(src, /company_id: form\.company_id\.trim\(\)|company_id: companyId/);
  assert.match(src, /preferredCompanyId/);
  assert.match(src, /pickPrimaryCompanyId/);
  assert.match(src, /filters=\{\{ search, department, empDepartment, company, payGroup, status \}\}/);
});

test("preferred company uses id 0001 helper, not business code 0001", () => {
  const helper = readFileSync(join(root, "lib/company.ts"), "utf8");
  assert.match(helper, /DEFAULT_COMPANY_ID = "0001"/);
  assert.match(helper, /c\.id === DEFAULT_COMPANY_ID/);
  assert.doesNotMatch(helper, /c\.code === "0001"/);
});

test("Employee Master uses Pay Group lookup master for filter and form", () => {
  const src = page();
  assert.match(src, /\/lookups\/pay_groups/);
  assert.match(src, /data-testid="filter-employee-pay-group"/);
  assert.match(src, /data-testid="input-employee-pay-group"/);
  assert.match(src, /payGroupMatches/);
  assert.match(src, /payGroupLabel/);
});
