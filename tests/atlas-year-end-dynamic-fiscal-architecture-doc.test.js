const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const docPath = path.join(root, 'docs', 'ATLAS_YEAR_END_DYNAMIC_FISCAL_ARCHITECTURE_2026-07-08.md');
const doc = fs.readFileSync(docPath, 'utf8');

assert.match(doc, /Open-Source Benchmarking and Comparison/, 'open-source comparison section missing');
assert.match(doc, /Odoo[\s\S]*ERPNext[\s\S]*Apache OFBiz/, 'benchmark systems missing');
assert.match(doc, /Dynamic Fiscal Year Switcher and Multi-Year Mutation Engine/, 'fiscal switcher architecture missing');
assert.match(doc, /HistoricalMutationRequest[\s\S]*MutationImpactReport/, 'historical mutation schemas missing');
assert.match(doc, /Every airfare rate[\s\S]*Preferences/, 'runtime preference guardrail missing');
assert.match(doc, /Self-Learning and Self-Correcting Engine/, 'self-learning engine section missing');
assert.match(doc, /Auto-Optimization Meta-Prompt/, 'auto-optimization meta-prompt missing');
assert.match(doc, /must not modify business formulas, database tables/, 'self-learning safety boundary missing');
assert.match(doc, /Phase-1 Verification Matrix/, 'verification matrix missing');

console.log('ATLAS dynamic fiscal architecture document checks passed');
