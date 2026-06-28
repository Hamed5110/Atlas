const assert = require('assert/strict');

const BASE_URL = process.env.ATLAS_TEST_URL || 'http://localhost:3355/api';
const USERNAME = process.env.ATLAS_TEST_USER || 'sa';
const PASSWORD = process.env.ATLAS_TEST_PASSWORD || 'Atlas@25';
const YEAR = Number(process.env.ATLAS_TEST_YEAR || new Date().getFullYear());
const AS_OF_DATE = process.env.ATLAS_TEST_AS_OF || `${YEAR}-06-21`;

async function api(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${options.method || 'GET'} ${path} failed ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  const session = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD })
  });

  assert.ok(session.token, 'login should return token');
  assert.ok(session.sessionId, 'login should return session id');
  const auth = {
    Authorization: `Bearer ${session.token}`,
    'X-Session-Id': session.sessionId
  };

  const [
    companies,
    employees,
    openingBalances,
    employeeReport,
    airfarePayable,
    yearEndPreview,
    loanSummary,
    intelligence,
    verification
  ] = await Promise.all([
    api('/companies', { headers: auth }),
    api('/employees', { headers: auth }),
    api(`/opening-balances?year=${YEAR}`, { headers: auth }),
    api('/reports/employee-master', { headers: auth }),
    api(`/reports/airfare-payable?year=${YEAR}&asOfDate=${AS_OF_DATE}`, { headers: auth }),
    api(`/year-end/preview/${YEAR}?closingDate=${YEAR}-12-31`, { headers: auth }),
    api('/loans/summary', { headers: auth }),
    api('/intelligence/control-center', { headers: auth }),
    api('/intelligence/verification', { headers: auth })
  ]);

  assert.ok(Array.isArray(companies), 'companies endpoint should return a list');
  assert.ok(companies.length >= 1, 'at least one company should exist');
  assert.ok(Array.isArray(employees) && employees.length > 0, 'employee master should contain employees');
  assert.ok(Array.isArray(employeeReport) && employeeReport.length >= employees.length, 'employee report should include active employees and may include inactive/reactivation rows');
  assert.ok(Array.isArray(openingBalances), 'opening balance register should be exportable/readable');
  assert.ok(Array.isArray(airfarePayable) && airfarePayable.length === employees.length, 'Airfare Payable report should cover all employees');
  assert.ok(yearEndPreview && Number(yearEndPreview.employeeCount || 0) > 0, 'year-end preview should calculate employees without closing');
  assert.ok(loanSummary && typeof loanSummary === 'object', 'loan summary should be available');
  assert.ok(intelligence?.summary, 'intelligence summary should be available');
  assert.ok(verification?.summary, 'system verification summary should be available');

  const entitlementTotal = airfarePayable.reduce((sum, row) => sum + Number(row.AirfareEntitlementAmount || 0), 0);
  const payableTotal = airfarePayable.reduce((sum, row) => sum + Number(row.PayableBHD || 0), 0);
  assert.ok(entitlementTotal >= 0, 'entitlement dashboard total should be non-negative');
  assert.ok(payableTotal >= entitlementTotal, 'full payable amount should be at least entitlement amount');
  assert.ok(Number(verification.summary.VerificationScore || 0) >= 80, 'Phase 1 verification score should stay healthy');

  console.log(JSON.stringify({
    status: 'phase1-smoke-passed',
    companies: companies.length,
    employees: employees.length,
    openingBalanceRows: openingBalances.length,
    airfarePayableRows: airfarePayable.length,
    entitlementTotal: Number(entitlementTotal.toFixed(2)),
    payableTotal: Number(payableTotal.toFixed(2)),
    loanOutstanding: Number(loanSummary.TotalOutstanding || 0),
    intelligenceStatus: intelligence.summary.OverallStatus,
    verificationStatus: verification.summary.VerificationStatus,
    verificationScore: verification.summary.VerificationScore
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
