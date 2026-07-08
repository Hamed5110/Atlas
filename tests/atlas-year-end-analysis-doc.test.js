const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const doc = fs.readFileSync(path.join(root, 'docs', 'ATLAS_YEAR_END_FEATURE_ANALYSIS_PROMPT_2026-07-08.md'), 'utf8');

assert.match(doc, /No business formula may be replaced/, 'document must preserve existing formulas');
assert.match(doc, /Airfare rate[\s\S]*preferences table at runtime/, 'document must enforce dynamic airfare preference lookup');
assert.match(doc, /Multi-company operation[\s\S]*isolate company assets/, 'document must enforce multi-company isolation');
assert.match(doc, /Data Mapping Validation Engine/, 'employee import feature addition missing');
assert.match(doc, /Double-Entry Ledger Audit Trail/, 'opening balance audit feature missing');
assert.match(doc, /Voucher Template Engine/, 'voucher template feature missing');
assert.match(doc, /Amortization Shift Engine/, 'loan amortization shift feature missing');
assert.match(doc, /Year-End Close[\s\S]*Closing Engine Calculation Logic/, 'year-end closing logic missing');
assert.match(doc, /Company-Wise and Year-Wise Selection Grid/, 'cross-year matrix architecture missing');
assert.match(doc, /Step 1: Selection and Filtering[\s\S]*Step 2: Exception Application[\s\S]*Step 3: Multi-User Confirmation Modal/, 'EMI three-step verification sequence missing');
assert.match(doc, /Company X \+ Year 2025[\s\S]*historical records/, 'company-year partition boundary example missing');

console.log('ATLAS year-end analysis document checks passed');
