const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const routeFile = path.join(root, 'atlas-hcm-next', 'app', '(dashboard)', 'preferences', 'page.tsx');
const exportedRoute = path.join(root, 'atlas-hcm-next', 'out', 'preferences', 'index.html');
const dashboardPage = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'app', 'page.tsx'), 'utf8');
const serverText = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const preferencesShell = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'features', 'preferences', 'components', 'PreferencesShell.tsx'), 'utf8');
const preferencesSchema = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'features', 'preferences', 'preferences.schema.ts'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release', 'atlas-release-manifest.json'), 'utf8'));

assert.ok(fs.existsSync(routeFile), 'Route file app/(dashboard)/preferences/page.tsx must exist');
assert.ok(fs.existsSync(exportedRoute), 'Static export must contain out/preferences/index.html; rebuild frontend before packaging');
assert.match(fs.readFileSync(exportedRoute, 'utf8'), /Preferences|ATLAS HCM|Settings Command Center/i, 'Exported preferences route must contain the new settings shell');
assert.match(dashboardPage, /window\.location\.href\s*=\s*"\/preferences\/"/, 'Legacy Preferences navigation must route to /preferences/');
assert.match(serverText, /app\.get\('\/api\/preferences'/, 'Backend must expose GET /api/preferences');
assert.match(serverText, /app\.put\('\/api\/preferences'/, 'Backend must expose PUT /api/preferences');
assert.match(serverText, /express\.static\(FRONTEND_BUILD_DIR[\s\S]*serveFrontendIndex/, 'Server must serve exported frontend routes and fallback safely');
assert.equal(manifest.version, '2.3.91', 'Release manifest should target the current 5110 fresh entitlement build version');
assert.ok(manifest.migrationPlan.some((step) => step.id === '20260801-preferences-schema-v2'), 'Manifest must include Preferences schema-v2 migration');
assert.doesNotMatch(preferencesShell, /Year End|year-end|YearEnd/, 'Preferences UI must not expose Year End copy; use continuous entitlement language');
assert.match(preferencesShell, /Entitlement Process/, 'Preferences UI must expose the continuous entitlement process section');
assert.match(preferencesSchema, /ATLAS_PREFERENCES_SCHEMA_VERSION = 3/, 'Preferences schema must advance to v3 for entitlement process settings');
assert.match(preferencesSchema, /entitlementWarnings/, 'Preferences schema must store entitlement warning preferences');

console.log('preferences route artifact checks passed');
