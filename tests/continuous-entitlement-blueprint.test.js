const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sqlText = fs.readFileSync(path.join(root, 'database', 'ContinuousAirfareEntitlement_Blueprint.sql'), 'utf8');
const docText = fs.readFileSync(path.join(root, 'docs', 'YEAR_END_REMOVAL_CONTINUOUS_ENTITLEMENT_BLUEPRINT.md'), 'utf8');

for (const table of [
  'EmployeeAirfareEntitlementPlans',
  'EmployeeAirfarePlanEnrollments',
  'EmployeeAirfareTransactions',
  'EmployeeAirfareBalances',
  'PayrollPeriodLocks'
]) {
  assert.match(sqlText, new RegExp(`CREATE TABLE dbo\\.${table}`, 'i'), `${table} must be defined`);
}

for (const procedure of [
  'sp_ATLAS_GetAirfareEntitlementBalance',
  'sp_ATLAS_PreviewAirfareEntitlementReset',
  'sp_ATLAS_ApplyAirfareTransaction'
]) {
  assert.match(sqlText, new RegExp(`CREATE OR ALTER PROCEDURE dbo\\.${procedure}`, 'i'), `${procedure} must be defined`);
}

assert.match(sqlText, /TransactionType IN \(N'accrual', N'usage', N'payout', N'adjustment', N'carryover', N'forfeiture', N'reversal'\)/i, 'transactions must capture all balance movement types');
assert.match(sqlText, /PayrollPeriodLocks[\s\S]*THROW 53004/i, 'airfare transactions must honor payroll period locks');
assert.match(sqlText, /SourceModule[\s\S]*SourceID[\s\S]*TransactionType[\s\S]*RETURN/i, 'transaction application must be idempotent by source');
assert.match(sqlText, /PolicySnapshotJSON/i, 'transactions must preserve policy snapshot evidence');
assert.match(sqlText, /IF OBJECT_ID\(N'dbo\.EmployeeAirfareEntitlementPlans'/i, 'migration must be additive/idempotent');
assert.doesNotMatch(sqlText, /DROP TABLE|TRUNCATE TABLE/i, 'blueprint migration must not destructively remove legacy data');

for (const phrase of [
  'no mandatory hard Year End close job',
  'fiscal year becomes a reporting dimension',
  'Legacy Year End History',
  'Phase 1: parallel continuous model',
  'Do not build another annual close under a new name'
]) {
  assert.match(docText, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `document missing: ${phrase}`);
}

console.log('continuous entitlement blueprint checks passed');
