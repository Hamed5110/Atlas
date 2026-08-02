const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const page = fs.readFileSync(path.join(root, "atlas-hcm-next", "app", "page.tsx"), "utf8");
const api = fs.readFileSync(path.join(root, "atlas-hcm-next", "lib", "atlas-api.ts"), "utf8");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const migration = fs.readFileSync(path.join(root, "database", "migrations", "2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql"), "utf8");

function includesAll(text, values, group) {
  for (const value of values) {
    assert.ok(text.includes(value), `${group} missing ${value}`);
  }
}

includesAll(server, [
  "ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT",
  "ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION",
  "ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES",
  "ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI",
  "ATLAS_CONTINUOUS_AIRFARE_ADMIN_ONLY",
  "getContinuousAirfareFeatureState",
  "requireFeatureFlag",
  "features,"
], "backend flags");

includesAll(server, [
  "app.get('/api/airfare/entitlement/balance'",
  "app.get('/api/airfare/entitlement/preview-reset'",
  "app.get('/api/airfare/entitlement/reconciliation'",
  "app.post('/api/airfare/entitlement/transaction'",
  "dbo.sp_ATLAS_GetAirfareEntitlementBalance",
  "dbo.sp_ATLAS_PreviewAirfareEntitlementReset",
  "FEATURE_DISABLED",
  "continuous-readonly",
  "continuous-reset-preview-readonly",
  "migration-reconciliation",
  "NOT_IMPLEMENTED_IN_PATCH_2_3_89"
], "backend routes");

includesAll(server, [
  "app.get('/api/diagnostics/entitlement'",
  "PlanCount",
  "EnrollmentCount",
  "TransactionCount",
  "continuous airfare reconciliation read"
], "diagnostics and logging");

includesAll(api, [
  "AtlasFeatureState",
  "AtlasVersionInfo",
  "AirfareEntitlementReconciliationResult",
  "atlasVersion"
], "frontend API types");

includesAll(page, [
  "canShowEntitlementReconciliation",
  "handleRunEntitlementReconciliation",
  "exportEntitlementReconciliationCsv",
  "Airfare Entitlement - Migration Debug",
  "Migration Debug / Reconciliation - not used for payroll",
  "Legacy Airfare Balance",
  "Continuous Airfare Balance",
  "Difference",
  "data-testid=\"airfare-entitlement-reconciliation\""
], "frontend reconciliation UI");

includesAll(envExample, [
  "ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT=false",
  "ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION=false",
  "ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES=false",
  "ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI=false",
  "ATLAS_CONTINUOUS_AIRFARE_ADMIN_ONLY=true"
], ".env.example flags");

assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i, "migration must remain additive");
assert.doesNotMatch(migration, /\bTRUNCATE\s+TABLE\b/i, "migration must not truncate");

// Regression tripwire: the legacy Year End route declarations must still be present.
includesAll(server, [
  "app.post('/api/year-end/preview/:year'",
  "app.post('/api/year-end/close'",
  "app.get('/api/year-end/history'"
], "legacy Year End routes");

console.log("Patch 2.3.89 implementation source checks passed");
