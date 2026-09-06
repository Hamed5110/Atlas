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
    "Job band",
    "Focus Soft Employee Information",
    "openEdit",
    "setDeleting",
    'title="Edit"',
    'title="Delete"',
  ]) {
    assert.match(src, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("opening balances, loans, users, lookups, and rates expose edit and/or delete", () => {
  const balances = read("app/(app)/opening-balances/page.tsx");
  assert.match(balances, /openEdit/);
  assert.match(balances, /setDeleting/);
  assert.match(balances, /title="Edit"/);
  assert.match(balances, /title="Delete"/);

  const loans = read("app/(app)/loans/page.tsx");
  assert.match(loans, /setDeleting/);
  assert.match(loans, /title="Delete"|Delete failed|label:\s*"Delete"/);

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
