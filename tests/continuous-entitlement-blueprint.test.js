const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sqlText = fs.readFileSync(path.join(root, 'database', 'ContinuousAirfareEntitlement_Blueprint.sql'), 'utf8');
const docText = fs.readFileSync(path.join(root, 'docs', 'PATCH_2_3_89_CONTINUOUS_ENTITLEMENT_PHASE_0_1_SPEC.md'), 'utf8');

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
  'Patch 2.3.89 removes the executable annual close path',
  'Continuous entitlement model',
  '`EmployeeAirfareTransactions` is the immutable ledger',
  'Opening balances are legacy seed data only',
  '`/api/year-end/*` must return `410 YEAR_END_PROCESS_REMOVED`'
]) {
  assert.match(docText, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `document missing: ${phrase}`);
}

console.log('continuous entitlement blueprint checks passed');
