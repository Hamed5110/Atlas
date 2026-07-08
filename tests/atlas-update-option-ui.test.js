const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'app', 'page.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'app', 'globals.css'), 'utf8');
const artifact = fs.readFileSync(path.join(root, 'docs', 'ATLAS_UPDATE_OPTION_UI_ARTIFACT_2026-07-08.md'), 'utf8');

assert.match(page, /System Maintenance/, 'System Maintenance view is missing');
assert.match(page, /Check for Updates/, 'Check for Updates command is missing');
assert.match(page, /Admin Settings \/ System Maintenance \/ Updates/, 'admin hierarchy label is missing');
assert.match(page, /handleCheckForUpdates[\s\S]*atlasHealth\(\)/, 'update command should verify existing ATLAS health');
assert.match(page, /session\.user\.role !== "admin"/, 'update controls should be admin guarded');
assert.match(css, /\.admin-profile-menu/, 'admin profile menu CSS is missing');
assert.match(css, /\.system-maintenance-hero/, 'system maintenance hero CSS is missing');
assert.match(css, /\.maintenance-status-grid/, 'update status grid CSS is missing');
assert.match(artifact, /Nextcloud admin updater/, 'artifact should document Nextcloud placement comparison');
assert.match(artifact, /Open WebUI admin settings/, 'artifact should document Open WebUI placement comparison');
assert.match(artifact, /VS Code update check/, 'artifact should document VS Code placement comparison');
assert.match(artifact, /Backend preservation/, 'artifact should document backend preservation');

console.log('ATLAS update option UI checks passed');
