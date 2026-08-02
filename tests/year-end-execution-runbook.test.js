const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const runbookPath = path.join(root, "docs", "YEAR_END_CONTINUOUS_ENTITLEMENT_EXECUTION_RUNBOOK.md");
const runbook = fs.readFileSync(runbookPath, "utf8");

function mustInclude(values, groupName) {
  for (const value of values) {
    assert.ok(runbook.includes(value), `${groupName} missing: ${value}`);
  }
}

mustInclude(
  [
    "No production Year End behavior changes in Phase 0-1.",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_BACKFILL=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI=false",
    "/api/version.features",
  ],
  "flags and boundary"
);

mustInclude(
  [
    "EmployeeAirfareEntitlementPlans",
    "EmployeeAirfarePlanEnrollments",
    "EmployeeAirfareTransactions",
    "EmployeeAirfareBalances",
    "PayrollPeriodLocks",
    "sp_ATLAS_GetAirfareEntitlementBalance",
    "sp_ATLAS_PreviewAirfareEntitlementReset",
    "sp_ATLAS_ApplyAirfareTransaction",
  ],
  "database object plan"
);

mustInclude(
  [
    "GET /api/airfare/entitlement/balance",
    "GET /api/airfare/entitlement/preview-reset",
    "GET /api/airfare/entitlement/reconciliation",
    "POST /api/airfare/entitlement/transaction",
    "FEATURE_DISABLED",
    "VALIDATION_ERROR",
  ],
  "API plan"
);

mustInclude(
  [
    "Airfare Entitlement - Migration Debug",
    "Legacy Airfare Balance",
    "Continuous Airfare Balance",
    "Difference",
    "OK",
    "MISSING_CONTINUOUS",
    "INVESTIGATE",
  ],
  "UI and reconciliation plan"
);

mustInclude(
  [
    "tests/airfare-phase1-integration.test.js",
    "test:airfare-phase1-integration",
    "sp_ATLAS_ReconcileLegacyVsContinuousAirfare",
    "all mismatches above BHD 0.010 are explained or corrected",
    "rollback is tested by flipping flags OFF",
  ],
  "validation plan"
);

mustInclude(
  [
    "Phase 2 - Continuous writes and reset preview/apply",
    "Phase 3 - Switch calculations and reports",
    "Phase 4 - Disable Year End close UI/API",
    "Phase 5 - Retire legacy active paths after audit retention",
    "Final \"Year End airfare close is removed\" checklist",
  ],
  "roadmap"
);

assert.doesNotMatch(runbook, /DROP TABLE dbo\.OpeningBalances/i, "runbook must not include executable legacy table drop");
assert.doesNotMatch(runbook, /TRUNCATE TABLE/i, "runbook must not include truncation instructions");
assert.match(runbook, /Do not combine installer\/version changes, DB write behavior, frontend close removal, and report source switching in one PR\./);

console.log("Year End continuous entitlement execution runbook contract passed");
