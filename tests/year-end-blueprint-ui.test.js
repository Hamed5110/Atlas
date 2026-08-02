const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'app', 'page.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'app', 'globals.css'), 'utf8');

for (const text of [
  'Operational blueprint',
  'Year End close is a controlled SQL evidence workflow',
  'Select company + fiscal year',
  'Preview only',
  'Readiness gate',
  'Final close with evidence',
  'No production close without a fresh previewId and previewHash',
  'No cross-company close'
]) {
  assert.match(page, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `Year End UI missing blueprint text: ${text}`);
}

assert.match(page, /yearEndBlueprintPhases[\s\S]*yearEndBlueprintGuards/, 'Year End blueprint must be data-driven in the component');
assert.match(page, /year-end-blueprint-panel[\s\S]*year-end-blueprint-grid[\s\S]*year-end-guardrail-strip/, 'Year End blueprint markup missing');
assert.match(css, /\.year-end-blueprint-panel[\s\S]*\.year-end-blueprint-grid[\s\S]*@media \(max-width: 720px\)/, 'Year End blueprint responsive CSS missing');

console.log('Year End blueprint UI checks passed');
