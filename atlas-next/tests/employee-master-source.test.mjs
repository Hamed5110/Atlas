import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("employees page exposes Focus-style master fields and edit/delete", () => {
  const src = read("app/(app)/employees/page.tsx");
  for (const token of [
    "arabic_name",
    "cpr_no",
    "passport_no",
    "designation",
    "nationality",
    "airline_sector",
    "travel_class",
    "monthly_salary",
    "visa_no",
    "pay_group",
    "sub_section",
    "reporting_officer_id",
    "select-reporting-officer",
    "EmployeeCombobox",
    "Type name or code",
    "Job band",
    // Master form copy: aligned with Focus Soft HR fields (import parses the
    // Focus Soft Employee Information workbook).
    "Focus Soft HR fields",
    "openEdit",
    "setDeleting",
    'title="Edit employee"',
    'title="Delete employee"',
  ]) {
    assert.match(src, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("employees Actions column is not sticky (no overlap of Pay Group / body columns)", () => {
  const src = read("app/(app)/employees/page.tsx");
  assert.doesNotMatch(
    src,
    /sticky\s+(?:end|right)-0/,
    "Actions cells must not use sticky end/right — that overlaps Pay Group and neighboring columns",
  );
  assert.match(src, /<TH className="text-end">Actions<\/TH>/);
  // The grid is slimmed (Sub section merged into Department, Nationality column
  // dropped, icon-only Actions) with a modest min-w floor so Actions stay
  // visible on desktop without horizontal scroll; the primitive's
  // overflow-x-auto wrapper plus the scroll-edge shadow affordance cover
  // narrower viewports.
  assert.match(
    src,
    /min-w-\[60rem\]/,
    "fit-to-viewport min-width floor keeps Actions reachable",
  );
});

test("opening balances, loans, users, lookups, and rates expose edit and/or delete", () => {
  const balances = read("app/(app)/opening-balances/page.tsx");
  assert.match(balances, /openEdit/);
  assert.match(balances, /setDeleting/);
  assert.match(balances, /title="Edit opening balance"/);
  assert.match(balances, /title="Delete opening balance"/);
  assert.doesNotMatch(
    balances,
    /sticky\s+(?:end|right)-0/,
    "opening-balances Actions must not use sticky end/right (same overlap pattern as employees)",
  );

  const loans = read("app/(app)/loans/page.tsx");
  assert.match(loans, /setDeleting/);
  // Delete affordances are i18n-driven (whole-loan delete + EMI payment delete).
  assert.match(loans, /loans\.confirm\.delete|btn-delete-payment-|loans\.emi\.delete/);

  const users = read("app/(app)/users/page.tsx");
  assert.match(users, /openEdit/);
  assert.match(users, /setDeleting/);
  assert.match(users, /title="Edit"/);
  assert.match(users, /title="Delete"/);

  const lookups = read("app/(app)/lookups/page.tsx");
  assert.match(lookups, /openEdit/);
  assert.match(lookups, /setDeleting/);
  assert.match(lookups, /title="Edit"/);

  const rates = read("app/(app)/rates/page.tsx");
  assert.match(rates, /openEdit/);
  assert.match(rates, /setDeleting/);
  assert.match(rates, /title="Edit"/);
});
