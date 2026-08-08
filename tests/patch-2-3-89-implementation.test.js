const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const page = fs.readFileSync(path.join(root, "atlas-hcm-next", "app", "page.tsx"), "utf8");
const api = fs.readFileSync(path.join(root, "atlas-hcm-next", "lib", "atlas-api.ts"), "utf8");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const migration = fs.readFileSync(path.join(root, "database", "migrations", "2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql"), "utf8");
const bootstrapperDeploy = fs.readFileSync(path.join(root, "installer", "bootstrapper", "deploy.ps1"), "utf8");
const installerInitializer = fs.readFileSync(path.join(root, "installer", "Initialize-ATLAS-Database.ps1"), "utf8");

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
  "app.get('/api/entitlement/compute'",
  "app.get('/api/entitlement/accruals'",
  "app.get('/api/entitlement/usage'",
  "app.get('/api/entitlement/accrual-forecast'",
  "app.get('/api/airfare/entitlement/balance'",
  "app.get('/api/airfare/entitlement/reconciliation'",
  "app.post('/api/airfare/entitlement/transaction'",
  "dbo.sp_ATLAS_GetAirfareEntitlementBalance",
  "FEATURE_DISABLED",
  "continuous-readonly",
  "continuous-entitlement-compute",
  "continuous-entitlement-accrual-ledger",
  "continuous-entitlement-usage-ledger",
  "continuous-entitlement-accrual-forecast",
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
  "ReconciliationPanel",
  "atlasFetch<AirfareEntitlementReconciliationResult>",
  "Migration debug / reconciliation",
  "Not used for payroll",
  "legacyAirfareBalance",
  "continuousAirfareBalance",
  "Difference",
  "Continuous model",
  "Entitlement Seeds"
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

// Regression tripwire: no annual close API route is registered.
assert.doesNotMatch(server, /\/api\/year-end|YEAR_END_PROCESS_REMOVED|sp_ATLAS_GetYearEndPreview|sp_ATLAS_PreviewAirfareEntitlementReset/, "annual close/reset route and procedures must not be active in Patch 2.3.89");
assert.doesNotMatch(page, /\{\s*label:\s*"Year End"/, "normal navigation must not expose annual close");
assert.doesNotMatch(page, /Year End|year-end|YearEnd|Open Year End blueprint|opening-year-end-bridge/, "frontend must not expose annual close labels or links");

includesAll(bootstrapperDeploy, [
  "DatabaseNameValue",
  "DB_NAME = $DatabaseNameValue",
  "ContinuousAirfareEntitlement_Blueprint.sql",
  "migrations\\2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql",
  "DB_NAME=$DatabaseName",
  "CREATE DATABASE $safeAppDbIdentifier"
], "interactive bootstrapper database setup");

includesAll(installerInitializer, [
  "ContinuousAirfareEntitlement_Blueprint.sql",
  "migrations\\2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql",
  "CutoverDate",
  "CreatedBy"
], "installed database initializer continuous entitlement repair");

console.log("Patch 2.3.89 implementation source checks passed");
