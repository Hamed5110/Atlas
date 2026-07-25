const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'database', 'ATLAS_YearEnd_Safety.sql'), 'utf8');
const closeRoute = server.slice(server.indexOf("app.post('/api/year-end/close'"), server.indexOf('// =====================================================\n// HEALTH CHECK'));
const previewRoute = server.slice(server.indexOf("app.post('/api/year-end/preview/:year'"), server.indexOf("// POST /api/year-end/close"));

assert.match(server, /scopeYearEndPreviewToCompany/, 'Year End must scope employees to the selected company');
assert.match(server, /getCompanyScopedYearEndTotals/, 'Year End summary totals must be scoped to the selected company');
assert.match(server, /assertCalendarYearEnd/, 'Year End must validate the configured close date');
assert.match(server, /assertYearEndCanBeFinalClosed/, 'Final close must reject years whose closing date has not passed');
assert.match(server, /assertLoanLedgerSafeForYearEndClose/, 'Final close must guard unsupported historical loan as-of balances');
assert.match(previewRoute, /app\.post\('\/api\/year-end\/preview\/:year'/, 'Preview must be a POST because it records preview evidence');
assert.match(previewRoute, /YearEndPreviewEvidence/, 'Preview must persist time-limited evidence');
assert.match(closeRoute, /previewId: Joi\.string\(\)\.guid/, 'Final close must require preview evidence');
assert.match(closeRoute, /YEAR_END_PREVIEW_STALE/, 'Final close must reject stale or missing evidence');
assert.match(closeRoute, /YEAR_END_DATA_CHANGED/, 'Final close must reject changed data');
assert.doesNotMatch(closeRoute, /employeeId:/, 'Final close must not accept employee-scoped closes');
assert.match(closeRoute, /YearEndEmployeeSnapshots/, 'Final close must persist employee snapshots');
assert.match(sql, /UX_YearEndHistory_CompanyYear/, 'History must be unique per company and year');
assert.match(sql, /tr_ATLAS_BlockClosedYearAllocationMutation/, 'Closed-year allocations must be locked in SQL');
assert.match(sql, /tr_ATLAS_BlockClosedYearOpeningBalanceMutation/, 'Closed-year opening balances must be locked in SQL');

console.log('Year End safety contract checks passed');
