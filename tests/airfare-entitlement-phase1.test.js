const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const specPath = path.join(root, "docs", "YEAR_END_PHASE_0_1_EXECUTABLE_SPEC.md");
const blueprintPath = path.join(root, "database", "ContinuousAirfareEntitlement_Blueprint.sql");
const removalPlanPath = path.join(root, "docs", "YEAR_END_CLOSE_REMOVAL_MIGRATION_PLAN.md");

const spec = fs.readFileSync(specPath, "utf8");
const blueprint = fs.readFileSync(blueprintPath, "utf8");
const removalPlan = fs.readFileSync(removalPlanPath, "utf8");

function mustInclude(text, values, groupName) {
  for (const value of values) {
    assert.ok(text.includes(value), `${groupName} missing: ${value}`);
  }
}

mustInclude(
  spec,
  [
    "This phase must not remove, disable, rename, or change production Year End behavior.",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_BACKFILL=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI=false",
  ],
  "phase 0-1 flags"
);

mustInclude(
  spec,
  [
    "GET /api/airfare/entitlement/balance",
    "GET /api/airfare/entitlement/reconciliation",
    "GET /api/airfare/entitlement/preview-reset",
    "POST /api/airfare/entitlement/transaction",
    "FEATURE_DISABLED",
    "VALIDATION_ERROR",
    "Migration Debug / Reconciliation",
  ],
  "phase 0-1 API/UI contract"
);

mustInclude(
  spec,
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
  "phase 0-1 database objects"
);

mustInclude(
  spec,
  [
    "OpeningBalances",
    "OpeningLoanBalances",
    "YearEndHistory",
    "YearEndEmployeeSnapshots",
    "/api/year-end/preview/:year",
    "/api/year-end/close",
    "/api/year-end/history",
  ],
  "legacy behavior preservation"
);

mustInclude(
  spec,
  [
    "runs cleanly twice",
    "row counts do not increase on second run",
    "no write happens to legacy Year End tables during backfill",
    "Production rollback should not drop tables",
    "Do not build preview-reset until balance and reconciliation are trusted.",
  ],
  "idempotency and rollback safety"
);

assert.match(blueprint, /CREATE TABLE dbo\.EmployeeAirfareEntitlementPlans/i);
assert.match(blueprint, /CREATE OR ALTER PROCEDURE dbo\.sp_ATLAS_GetAirfareEntitlementBalance/i);
assert.doesNotMatch(blueprint, /DROP TABLE|TRUNCATE TABLE/i, "blueprint must stay additive");

assert.match(removalPlan, /Phase 1 - Parallel model, read-only/i);
assert.match(removalPlan, /Phase 2 - Parallel writes, preview\/reset only/i);

console.log("Phase 0-1 continuous airfare entitlement executable spec contract passed");
