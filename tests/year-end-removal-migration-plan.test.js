const fs = require("fs");
const path = require("path");
const assert = require("assert");

const repoRoot = path.resolve(__dirname, "..");
const planPath = path.join(repoRoot, "docs", "YEAR_END_CLOSE_REMOVAL_MIGRATION_PLAN.md");

function readPlan() {
  assert.ok(fs.existsSync(planPath), "Year End removal migration plan must exist");
  return fs.readFileSync(planPath, "utf8");
}

function assertIncludesAll(haystack, needles, groupName) {
  for (const needle of needles) {
    assert.ok(
      haystack.includes(needle),
      `${groupName} missing required contract text: ${needle}`
    );
  }
}

const plan = readPlan();

assertIncludesAll(
  plan,
  [
    "Do not remove Year End in one patch",
    "The dangerous misconception is \"Year End is only a screen.\"",
    "Current-state dependency map",
    "Hidden couplings",
    "Data migration design",
    "Reconciliation query",
    "Rollback",
    "Final \"Year End removed\" state",
  ],
  "plan structure"
);

assertIncludesAll(
  plan,
  [
    "ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=false",
    "ENABLE_CONTINUOUS_AIRFARE_WRITES=false",
    "ENABLE_CONTINUOUS_AIRFARE_REPORTS=false",
    "DISABLE_YEAR_END_CLOSE_UI=false",
    "DISABLE_YEAR_END_CLOSE_API=false",
    "ENABLE_LEGACY_YEAR_END_ARCHIVE=true",
    "ENABLE_ENTITLEMENT_RECONCILIATION=true",
  ],
  "feature flags"
);

assertIncludesAll(
  plan,
  [
    "Phase 0 - Prep and flags",
    "Phase 1 - Parallel model, read-only",
    "Phase 2 - Parallel writes, preview/reset only",
    "Phase 3 - Switch calculations and reports",
    "Phase 4 - Disable Year End close UI/API",
    "Phase 5 - Retire legacy objects after audit retention",
  ],
  "phases"
);

assertIncludesAll(
  plan,
  [
    "server.js",
    "atlas-hcm-next/app/page.tsx",
    "release/atlas-release-manifest.json",
    "/api/year-end/close",
    "/api/year-end/history",
    "/api/airfare-entitlement/balances",
    "/api/airfare-entitlement/reconciliation",
  ],
  "source and API boundaries"
);

assertIncludesAll(
  plan,
  [
    "EmployeeAirfareEntitlementPlans",
    "EmployeeAirfarePlanEnrollments",
    "EmployeeAirfareTransactions",
    "OpeningBalances",
    "Allocations",
    "Difference",
    "vw_ATLAS_AirfareEntitlementBalanceAsOf",
  ],
  "migration and reconciliation SQL"
);

assertIncludesAll(
  plan,
  [
    "read-only archive",
    "idempotent",
    "reversal transaction, not delete",
    "DROPs are non-reversible without backup",
    "No unexplained balance discrepancy above BHD 0.010",
  ],
  "safety controls"
);

assert.ok(
  !/\bDROP\s+TABLE\b/i.test(plan),
  "plan must not contain executable DROP TABLE instructions for legacy audit tables"
);

console.log("Year End close removal migration plan contract passed");
