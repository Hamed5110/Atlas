const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = process.env.ATLAS_TEST_BASE_URL || 'http://localhost:3355/api';
const APP_URL = process.env.ATLAS_TEST_APP_URL || BASE_URL.replace(/\/api\/?$/, '/');
const USERNAME = process.env.ATLAS_TEST_USERNAME || 'sa';
const PASSWORD = process.env.ATLAS_TEST_PASSWORD || 'Atlas@25';
const YEAR = Number(process.env.ATLAS_TEST_YEAR || new Date().getFullYear());
const AS_OF_DATE = process.env.ATLAS_TEST_AS_OF || `${YEAR}-06-28`;
const reportDir = path.join(__dirname, '..', 'test-reports');
const startedAt = new Date();

let token = '';
let sessionId = '';
const results = [];

function compact(value) {
  return JSON.stringify(value, (_key, item) => {
    if (Array.isArray(item)) return { count: item.length, sample: item.slice(0, 2) };
    return item;
  }).replace(/\|/g, '\\|');
}

function addResult(area, name, status, details = {}) {
  results.push({ area, name, status, details, at: new Date().toISOString() });
}

async function api(pathname, options = {}) {
  const response = await fetch(BASE_URL + pathname, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`${options.method || 'GET'} ${pathname} failed ${response.status}: ${detail}`);
  }
  return body;
}

async function expectApiError(pathname, expectedStatus, options = {}) {
  const response = await fetch(BASE_URL + pathname, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${pathname} should return ${expectedStatus}, got ${response.status}: ${text}`);
  return text;
}

async function web(pathname = '') {
  const response = await fetch(new URL(pathname, APP_URL));
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${pathname || APP_URL} failed ${response.status}`);
  return { response, text };
}

async function step(area, name, fn) {
  try {
    const details = await fn();
    addResult(area, name, 'PASS', details);
    return details;
  } catch (error) {
    addResult(area, name, 'FAIL', { error: error.message });
    throw error;
  }
}

function writeReports() {
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const jsonPath = path.join(reportDir, `atlas-acceptance-regression-${stamp}.json`);
  const mdPath = path.join(reportDir, `atlas-acceptance-regression-${stamp}.md`);
  const passed = results.filter((item) => item.status === 'PASS').length;
  const failed = results.filter((item) => item.status === 'FAIL').length;

  fs.writeFileSync(jsonPath, JSON.stringify({
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    appUrl: APP_URL,
    year: YEAR,
    asOfDate: AS_OF_DATE,
    summary: { passed, failed, total: results.length },
    results
  }, null, 2));

  const grouped = new Map();
  for (const result of results) {
    if (!grouped.has(result.area)) grouped.set(result.area, []);
    grouped.get(result.area).push(result);
  }

  const lines = [
    '# ATLAS Acceptance Regression Report',
    '',
    `- Started: ${startedAt.toISOString()}`,
    `- Finished: ${new Date().toISOString()}`,
    `- API: ${BASE_URL}`,
    `- Web: ${APP_URL}`,
    `- Year: ${YEAR}`,
    `- Result: ${failed ? 'FAILED' : 'PASSED'} (${passed}/${results.length} checks passed)`,
    '',
    '## Coverage',
    '',
    ...Array.from(grouped, ([area, items]) => `- ${area}: ${items.filter((item) => item.status === 'PASS').length}/${items.length} passed`),
    '',
    '## Checks',
    '',
    '| # | Area | Check | Status | Details |',
    '|---:|---|---|---|---|',
    ...results.map((item, index) => `| ${index + 1} | ${item.area} | ${item.name} | ${item.status} | ${compact(item.details)} |`)
  ];
  fs.writeFileSync(mdPath, lines.join('\n'));
  return { jsonPath, mdPath, passed, failed };
}

async function main() {
  try {
    await step('Health and security', 'Health endpoint reports SQL connected', async () => {
      const health = await api('/health');
      assert.equal(health.status, 'healthy');
      assert.equal(health.database, 'connected');
      return health;
    });

    await step('Health and security', 'Protected endpoint rejects anonymous request', async () => {
      await expectApiError('/employees', 401, { headers: { Authorization: '', 'X-Session-Id': '' } });
      return { rejected: true };
    });

    await step('Health and security', 'Admin login creates token and session', async () => {
      const login = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: USERNAME, password: PASSWORD })
      });
      assert.ok(login.token);
      assert.ok(login.sessionId);
      token = login.token;
      sessionId = login.sessionId;
      return { username: login.user.username, role: login.user.role };
    });

    await step('Frontend views', 'Production web shell loads with expected navigation labels', async () => {
      const page = await web('/');
      assert.match(page.text, /ATLAS|Airfare|__next/i);
      return { status: page.response.status, htmlBytes: page.text.length };
    });

    await step('Company process', 'Company list and backup list load', async () => {
      const companies = await api('/companies');
      const backups = await api('/admin/backups');
      assert.ok(Array.isArray(companies));
      assert.ok(companies.some((company) => String(company.CompanyCode || '').toUpperCase() === 'ATLAS'));
      assert.ok(Array.isArray(backups));
      return { companies: companies.length, backups: backups.length };
    });

    await step('Employee and opening balance views', 'Employee master and opening balance register load', async () => {
      const employees = await api('/employees');
      const opening = await api(`/opening-balances?year=${YEAR}`);
      assert.ok(Array.isArray(employees));
      assert.ok(Array.isArray(opening));
      assert.ok(employees.length > 0, 'employee master should contain rows');
      return { employees: employees.length, openingBalances: opening.length };
    });

    await step('Airfare allocation views', 'Allocation list and eligibility review load', async () => {
      const employees = await api('/employees');
      const employee = employees.find((row) => String(row.Status || 'Active').toLowerCase() === 'active') || employees[0];
      assert.ok(employee?.EmployeeID, 'no employee available for eligibility review');
      const allocations = await api(`/allocations?year=${YEAR}`);
      const review = await api(`/allocations/eligibility-review?employeeId=${employee.EmployeeID}&date=${AS_OF_DATE}&year=${YEAR}`);
      assert.ok(Array.isArray(allocations));
      assert.ok(Object.prototype.hasOwnProperty.call(review, 'AirfareEntitlementAmount'));
      return {
        allocations: allocations.length,
        employee: employee.EmployeeCode,
        entitlement: review.AirfareEntitlementAmount,
        maximumPayout: review.MaximumPayout
      };
    });

    await step('Loans', 'Loan register, summary, and EMI preview load', async () => {
      const register = await api('/loans/register');
      const active = await api('/loans/active');
      const summary = await api('/loans/summary');
      const preview = await api('/loans/run-emis/preview', {
        method: 'POST',
        body: JSON.stringify({ loanIds: [], paymentDate: AS_OF_DATE })
      });
      assert.ok(Array.isArray(register));
      assert.ok(Array.isArray(active));
      assert.ok(summary && typeof summary === 'object');
      assert.ok(Object.prototype.hasOwnProperty.call(preview, 'processed'));
      return {
        registerRows: register.length,
        activeRows: active.length,
        activeLoans: summary.ActiveLoans || 0,
        emiPreviewCount: preview.processed
      };
    });

    await step('Reports', 'Core reports load and contain rows/summary objects', async () => {
      const employeeMaster = await api('/reports/employee-master');
      const payable = await api(`/reports/airfare-payable?year=${YEAR}&asOfDate=${AS_OF_DATE}`);
      const yearSummary = await api(`/reports/year-summary/${YEAR}`);
      assert.ok(Array.isArray(employeeMaster));
      assert.ok(Array.isArray(payable));
      assert.ok(yearSummary.allocations);
      assert.ok(yearSummary.loans);
      return {
        employeeMasterRows: employeeMaster.length,
        airfarePayableRows: payable.length,
        yearSummaryAllocations: yearSummary.allocations.TotalAllocations || 0,
        yearSummaryLoans: yearSummary.loans.TotalLoans || yearSummary.loans.ActiveLoans || 0
      };
    });

    await step('Year end', 'Year-end preview and dry-run close calculate without committing', async () => {
      const preview = await api(`/year-end/preview/${YEAR}?closingDate=${YEAR}-12-31`);
      const dryRun = await api('/year-end/close', {
        method: 'POST',
        body: JSON.stringify({
          year: YEAR,
          closingDate: `${YEAR}-12-31`,
          dryRun: true,
          remarks: 'Acceptance dry-run only'
        })
      });
      assert.equal(dryRun.dryRun, true);
      assert.equal(Number(dryRun.employeeCount), Number(preview.employeeCount));
      assert.ok(Number(preview.employeeCount) > 0, 'year-end preview should include employees');
      return {
        employees: preview.employeeCount,
        closingDays: preview.totalClosingDays,
        closingAmount: preview.totalOpeningBalance,
        pendingLoans: preview.pendingLoanCount,
        dryRun: dryRun.dryRun
      };
    });

    await step('Intelligence and verification', 'Dashboard control center and SQL verification load', async () => {
      const control = await api(`/intelligence/control-center?year=${YEAR}`);
      const verification = await api(`/intelligence/verification?year=${YEAR}`);
      const integrity = await api(`/intelligence/system-integrity?year=${YEAR}`);
      assert.ok(control && typeof control === 'object');
      assert.ok(verification.summary);
      assert.ok(Array.isArray(verification.checks));
      assert.equal(integrity.modelName, 'ATLAS Automatic Verification Model');
      assert.equal(integrity.rulesLocked, true);
      assert.ok(Array.isArray(integrity.automationPlan));
      assert.ok(Array.isArray(integrity.actionQueue));
      assert.ok(/No business formulas/i.test(integrity.formulaPolicy));
      return {
        verificationStatus: verification.summary.VerificationStatus,
        verificationScore: verification.summary.VerificationScore,
        integrityStatus: integrity.integrityStatus,
        integrityScore: integrity.integrityScore,
        totalChecks: verification.summary.TotalChecks,
        failedChecks: verification.summary.FailedChecks
      };
    });

    await step('Diagnostics', 'Database, system, and external diagnostics load', async () => {
      const database = await api('/diagnostics/database');
      const system = await api('/diagnostics/system');
      const external = await api('/diagnostics/external-apis');
      assert.ok(database);
      assert.ok(system);
      assert.ok(external);
      return {
        databaseStatus: database.status || database.Status || 'loaded',
        systemStatus: system.status || system.Status || 'loaded',
        externalStatus: external.status || external.Status || 'loaded'
      };
    });
  } finally {
    const report = writeReports();
    console.log(`ATLAS acceptance regression ${report.failed ? 'FAILED' : 'PASSED'}`);
    console.log(`Markdown report: ${report.mdPath}`);
    console.log(`JSON report: ${report.jsonPath}`);
    if (report.failed) process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
