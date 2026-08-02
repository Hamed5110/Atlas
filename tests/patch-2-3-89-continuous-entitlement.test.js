const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const specPath = path.join(root, "docs", "PATCH_2_3_89_CONTINUOUS_ENTITLEMENT_PHASE_0_1_SPEC.md");
const migrationPath = path.join(root, "database", "migrations", "2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql");
const packagePath = path.join(root, "package.json");

const spec = fs.readFileSync(specPath, "utf8");
const migration = fs.readFileSync(migrationPath, "utf8");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8").replace(/^\uFEFF/, ""));

function mustInclude(text, values, groupName) {
  for (const value of values) {
    assert.ok(text.includes(value), `${groupName} missing: ${value}`);
  }
}

mustInclude(
  spec,
  [
    "Patch 2.3.89 removes the executable annual close path.",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_BACKFILL=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI=false",
    "continuousAirfareEntitlement",
    "continuousAirfareAdminOnly",
  ],
  "patch flags"
);

mustInclude(
  spec,
  [
    "GET /api/entitlement/compute",
    "GET /api/entitlement/accruals",
    "GET /api/entitlement/usage",
    "GET /api/airfare/entitlement/balance",
    "GET /api/airfare/entitlement/reconciliation",
    "POST /api/airfare/entitlement/transaction",
    "FEATURE_DISABLED",
    "continuous-readonly",
    "migration-reconciliation",
  ],
  "API contract"
);

mustInclude(
  spec,
  [
    "Airfare Entitlement - Migration Debug",
    "Legacy Airfare Balance",
    "Continuous Airfare Balance",
    "Difference",
    "Status",
    "Notes",
  ],
  "frontend contract"
);

mustInclude(
  spec,
  [
    "Patch success criteria",
  ],
  "release and rollback plan"
);

mustInclude(
  migration,
  [
    ":r ..\\ContinuousAirfareEntitlement_Blueprint.sql",
    "EmployeeAirfareEntitlementPlans",
    "EmployeeAirfarePlanEnrollments",
    "EmployeeAirfareTransactions",
    "PayrollPeriodLocks",
    "Allocations",
    "NOT EXISTS",
    "AccrualFrequency",
    "N'monthly'",
    "PlanCount",
    "EnrollmentCount",
    "TransactionCount",
  ],
  "migration contract"
);

assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i, "patch migration must not drop tables");
assert.doesNotMatch(migration, /\bTRUNCATE\s+TABLE\b/i, "patch migration must not truncate tables");
assert.doesNotMatch(migration, /\bALTER\s+TABLE\s+dbo\.(OpeningBalances|OpeningLoanBalances|YearEndHistory|YearEndEmployeeSnapshots)\b/i, "patch migration must not alter legacy close tables");
assert.doesNotMatch(migration, /N'calendar_year'|N'annual'|N'lump_sum'/i, "Patch 2.3.89 seed must not install annual reset/accrual defaults");

assert.ok(pkg.scripts["test:patch-2-3-89"], "package.json must expose test:patch-2-3-89");

console.log("Patch 2.3.89 continuous entitlement contract passed");
