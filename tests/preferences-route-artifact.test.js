const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dashboardPage = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'app', 'page.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'app', 'globals.css'), 'utf8');
const serverText = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const preferencesShell = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'features', 'preferences', 'components', 'PreferencesShell.tsx'), 'utf8');
const preferencesSchema = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'features', 'preferences', 'preferences.schema.ts'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release', 'atlas-release-manifest.json'), 'utf8'));

assert.match(dashboardPage, /FreshAtlasApp/, 'Active app/page.tsx must be the fresh rebuilt shell');
assert.match(dashboardPage, /Fresh build · port 3356/, 'Fresh shell must identify the 3356 build line');
assert.match(dashboardPage, /Entitlement Seeds/, 'Fresh shell must rename opening evidence to entitlement seeds');
assert.match(dashboardPage, /No annual reset screen/, 'Fresh shell must state that the old annual reset screen is removed');
assert.match(dashboardPage, /atlasFetch<AirfareEntitlementReconciliationResult>/, 'Fresh shell must call the typed reconciliation API');
assert.match(dashboardPage, /fiscalAsOfDate/, 'Fresh shell must derive a deterministic YYYY-MM-DD asOfDate from the selected fiscal cycle');
assert.match(dashboardPage, /reconciliation\?asOfDate=\$\{asOfDate\}&tolerance=0\.01/, 'Reconciliation API calls must send asOfDate, not only year');
assert.doesNotMatch(dashboardPage, /reconciliation\?year=\$\{fiscalCycle\}/, 'Reconciliation API must not omit required asOfDate');
assert.match(dashboardPage, /calculateExcelTotal[\s\S]*closingBalanceDays/, 'Fresh shell must keep using existing ATLAS formula helpers');
assert.match(css, /\.atlas-root[\s\S]*grid-template-columns:\s*var\(--sidebar\)\s*minmax\(0,\s*1fr\)/, 'Fresh shell must use the new strict app grid');
assert.match(css, /\.atlas-sidebar[\s\S]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto/, 'Sidebar must use isolated header/context/nav/footer zones');
assert.match(serverText, /app\.get\('\/api\/preferences'/, 'Backend must expose GET /api/preferences');
assert.match(serverText, /app\.put\('\/api\/preferences'/, 'Backend must expose PUT /api/preferences');
assert.equal(manifest.version, '2.3.92', 'Release manifest should target the current 3356 fresh entitlement build version');
assert.equal(Number(manifest.service.port), 3356, 'Release manifest service port must be 3356');
assert.doesNotMatch(dashboardPage, /Year End|year-end|YearEnd|Update next year|prepareNextYearOpeningUpdate|5110/, 'Active frontend must not expose old process labels, carry-forward action, or 5110');
assert.doesNotMatch(preferencesShell, /Year End|year-end|YearEnd/, 'Preferences UI must not expose old process copy; use continuous entitlement language');
assert.match(preferencesShell, /Entitlement Process/, 'Preferences UI must expose the continuous entitlement process section');
assert.match(preferencesSchema, /ATLAS_PREFERENCES_SCHEMA_VERSION = 3/, 'Preferences schema must remain v3 for entitlement process settings');
assert.match(preferencesSchema, /entitlementWarnings/, 'Preferences schema must store entitlement warning preferences');

console.log('fresh 3356 route artifact checks passed');
