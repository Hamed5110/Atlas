const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'app', 'page.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'app', 'globals.css'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const artifact = fs.readFileSync(path.join(root, 'docs', 'ATLAS_COMPANY_CLEANUP_UI_ARTIFACT_2026-07-08.md'), 'utf8');

assert.match(page, /Preview cleanup/, 'Companies screen should expose cleanup preview');
assert.match(page, /companyCleanupPreview/, 'Companies screen should render cleanup evidence');
assert.match(page, /opening-balance-row/, 'Opening Balance rows should have a dedicated layout class');
assert.match(page, /opening-register-toolbar/, 'Opening Balance should use a compact register toolbar');
assert.doesNotMatch(page, /Company-wise year switcher/, 'Opening Balance should not use the bulky year switcher copy');
assert.match(css, /\.table-row\.opening-balance-row/, 'Opening Balance row layout CSS is missing');
assert.match(css, /\.opening-register-toolbar/, 'Opening Balance compact toolbar CSS is missing');
assert.match(css, /\.company-cleanup-preview/, 'Company cleanup preview CSS is missing');
assert.match(server, /getCompanyCleanupPreview/, 'Backend cleanup preview helper is missing');
assert.match(server, /app\.get\('\/api\/companies\/cleanup-preview'/, 'Backend cleanup preview route is missing');
assert.match(server, /CleanupReason/, 'Cleanup rows should include user-readable reasons');
assert.match(artifact, /ERPNext/, 'Artifact should document ERPNext comparison');
assert.match(artifact, /Odoo/, 'Artifact should document Odoo comparison');

console.log('ATLAS company cleanup UI checks passed');
