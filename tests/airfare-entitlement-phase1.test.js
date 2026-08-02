const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const specPath = path.join(root, "docs", "PATCH_2_3_89_CONTINUOUS_ENTITLEMENT_PHASE_0_1_SPEC.md");
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
    "Patch 2.3.89 removes the executable annual close path.",
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
    "GET /api/entitlement/compute",
    "GET /api/entitlement/accruals",
    "GET /api/entitlement/usage",
    "GET /api/airfare/entitlement/balance",
    "GET /api/airfare/entitlement/reconciliation",
    "POST /api/airfare/entitlement/transaction",
    "GET /api/entitlement/accrual-forecast",
    "Continuous Entitlement Reconciliation",
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
    "sp_ATLAS_ApplyAirfareTransaction",
    "sp_ATLAS_ForecastAirfareAccruals",
  ],
  "phase 0-1 database objects"
);

mustInclude(
  spec,
  [
    "Opening balances are legacy seed data only",
    "No annual close API route is registered",
    "No normal navigation item for annual close",
  ],
  "legacy close removal"
);

mustInclude(
  spec,
  [
    "use `NOT EXISTS` guards",
    "avoid destructive SQL",
    "No migration entry may be named like an annual-close migration",
  ],
  "idempotency and rollback safety"
);

assert.match(blueprint, /CREATE TABLE dbo\.EmployeeAirfareEntitlementPlans/i);
assert.match(blueprint, /CREATE OR ALTER PROCEDURE dbo\.sp_ATLAS_GetAirfareEntitlementBalance/i);
assert.doesNotMatch(blueprint, /DROP TABLE|TRUNCATE TABLE/i, "blueprint must stay additive");

assert.match(removalPlan, /Phase 1 - Parallel model, read-only/i);
assert.match(removalPlan, /Phase 2 - Parallel writes, preview\/reset only/i);

console.log("Phase 0-1 continuous airfare entitlement executable spec contract passed");

