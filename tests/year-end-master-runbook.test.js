const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const runbookPath = path.join(root, "docs", "YEAR_END_CONTINUOUS_ENTITLEMENT_MASTER_RUNBOOK.md");
const packagePath = path.join(root, "package.json");

const runbook = fs.readFileSync(runbookPath, "utf8");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8").replace(/^\uFEFF/, ""));

function mustInclude(values, label) {
  for (const value of values) {
    assert.ok(runbook.includes(value), `${label} missing: ${value}`);
  }
}

mustInclude(
  [
    "Patch 2.3.89 is not the Year End removal patch.",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_BACKFILL=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES=false",
    "ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI=false",
    "config.flags.ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT",
    "/api/version.features",
  ],
  "flag and truth boundary"
);

mustInclude(
  [
    "database/migrations/2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql",
    "EmployeeAirfareEntitlementPlans",
    "EmployeeAirfarePlanEnrollments",
    "EmployeeAirfareTransactions",
    "EmployeeAirfareBalances",
    "PayrollPeriodLocks",
    "sp_ATLAS_GetAirfareEntitlementBalance",
    "sp_ATLAS_PreviewAirfareEntitlementReset",
    "sp_ATLAS_ApplyAirfareTransaction",
    "SQLCMD",
    "idempotency",
  ],
  "DB execution plan"
);

mustInclude(
  [
    "GET /api/airfare/entitlement/balance",
    "GET /api/airfare/entitlement/preview-reset",
    "GET /api/airfare/entitlement/reconciliation",
    "POST /api/airfare/entitlement/transaction",
    "FEATURE_DISABLED",
    "continuous-readonly",
    "migration-reconciliation",
  ],
  "API plan"
);

mustInclude(
  [
    "Airfare Entitlement - Migration Debug",
    "Migration Debug / Reconciliation - not used for payroll.",
    "Legacy Airfare Balance",
    "Continuous Airfare Balance",
    "Difference",
    "Status",
    "Notes",
  ],
  "frontend plan"
);

mustInclude(
  [
    "Staging decision gate",
    "Production success",
    "Fast rollback",
    "Monitoring",
    "Reconciliation process",
    "Phase 2 entry criteria",
  ],
  "deployment operations"
);

mustInclude(
  [
    "Phase 2 - Continuous writes and reset preview/apply",
    "Phase 3 - Switch calculations and reports",
    "Phase 4 - Disable Year End close UI/API",
    "Phase 5 - Retire legacy objects after audit retention",
    "Final Year End removed architecture",
    "Final checklist",
  ],
  "full roadmap"
);

mustInclude(
  [
    "Engineers/QA",
    "HR/admin users",
    "Support",
    "DBA",
    "Future Phase 4 communications",
    "Do not combine these in one PR",
  ],
  "communications"
);

assert.doesNotMatch(runbook, /\bDROP\s+TABLE\b/i, "master runbook must not include executable DROP TABLE guidance");
assert.doesNotMatch(runbook, /\bTRUNCATE\s+TABLE\b/i, "master runbook must not include truncation guidance");
assert.ok(pkg.scripts["test:year-end-master-runbook"], "package.json must expose test:year-end-master-runbook");

console.log("Year End continuous entitlement master runbook contract passed");
