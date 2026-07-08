const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const blueprint = fs.readFileSync(path.join(root, 'docs', 'ATLAS_QA_SYSTEM_TESTING_BLUEPRINT_2026-07-08.md'), 'utf8');

assert.match(blueprint, /Dynamic airfare rate[\s\S]*preferences at runtime/, 'blueprint must enforce runtime airfare preferences');
assert.match(blueprint, /Multi-company isolation[\s\S]*logos, names, sessions, records, and schemas/, 'blueprint must enforce multi-company isolation');
assert.match(blueprint, /Open-Source Gap Analysis Matrix/, 'blueprint must include open-source comparison');
assert.match(blueprint, /Employee Import with Selection Screen/, 'employee import module missing');
assert.match(blueprint, /Opening Balance Management/, 'opening balance module missing');
assert.match(blueprint, /Airfare Allocation with Print Functions/, 'airfare allocation module missing');
assert.match(blueprint, /Loan Management/, 'loan management module missing');
assert.match(blueprint, /Year-End Process and Cross-Year Shifting/, 'year-end module missing');
assert.match(blueprint, /Multi-Company Login, Logout, and Theming/, 'multi-company module missing');
assert.match(blueprint, /Preferences Setting with Dynamic Airfare Rate/, 'preferences module missing');
assert.match(blueprint, /Step 1: Selection and filtering[\s\S]*Step 2: Exception application[\s\S]*Step 3: Multi-user confirmation/, 'EMI three-step workflow missing');

console.log('ATLAS QA blueprint document checks passed');
