const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'app', 'page.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'app', 'globals.css'), 'utf8');
const artifact = fs.readFileSync(path.join(root, 'docs', 'ATLAS_DASHBOARD_PREFERENCES_INSTALLER_ARTIFACT_2026-07-08.md'), 'utf8');

assert.match(page, /className="kpi-money"/, 'overview KPI money rendering should split currency and amount');
assert.match(page, /className="metric-money"/, 'metric cards should support money-specific rendering');
assert.match(page, /analytics-disclosure glass-panel" open/, 'advanced analytics should be active by default');
assert.match(page, /preference-current-row/, 'current preference table should have its own layout');
assert.match(page, /preference-row-actions/, 'preference rows should expose direct actions');
assert.doesNotMatch(page, /max="150" placeholder="Preference amount"/, 'preference amount input should not be hard-limited to 150');
assert.match(css, /\.kpi-money b[\s\S]*white-space:\s*nowrap/, 'KPI amounts should not wrap');
assert.match(css, /\.table-row\.preference-current-row/, 'current preference row CSS is missing');
assert.match(artifact, /Material responsive grid/, 'artifact should document Material responsive grid comparison');
assert.match(artifact, /Global Preferences/, 'artifact should document global preference action repair');

console.log('ATLAS dashboard preferences artifact checks passed');
