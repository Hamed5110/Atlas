const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'app', 'page.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'app', 'globals.css'), 'utf8');
const artifact = fs.readFileSync(path.join(root, 'docs', 'ATLAS_GLOBAL_FISCAL_YEAR_SWITCH_ARTIFACT_2026-07-08.md'), 'utf8');

assert.match(page, /activeFiscalYear/, 'global fiscal year state missing');
assert.match(page, /handleFiscalYearSwitch/, 'global fiscal year switch handler missing');
assert.match(page, /loadLiveData\(activeSession = session, fiscalYearValue/, 'live data loader must accept selected fiscal year');
assert.match(page, /allocations\?year=\$\{reportYear\}/, 'allocations must load from selected fiscal year');
assert.match(page, /reports\/year-summary\/\$\{reportYear\}/, 'year summary must load from selected fiscal year');
assert.match(page, /reports\/airfare-payable\?year=\$\{reportYear\}/, 'airfare payable must load from selected fiscal year');
assert.match(page, /opening-balances\?year=\$\{openingYear\}/, 'opening balances must load from selected fiscal year');
assert.match(page, /Fiscal year/, 'sidebar fiscal year switch must be visible');
assert.match(page, /Update next year/, 'opening balance next-year update option missing');
assert.match(page, /updated\. Fiscal year/, 'allocation edit save confirmation must name fiscal year');
assert.match(css, /\.fiscal-context-switcher/, 'global fiscal switcher styling missing');
assert.match(css, /\.fiscal-context-chip/, 'topbar fiscal context chip styling missing');
assert.match(artifact, /Fiscal year is a workspace-level context/, 'artifact must document corrected system rule');
assert.match(artifact, /Edit \/ Update to Next Year Rule/, 'artifact must document next-year update behavior');

console.log('ATLAS global fiscal switch artifact checks passed');
