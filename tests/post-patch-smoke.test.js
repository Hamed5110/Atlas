const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
require('dotenv').config();

const APP_BASE_URL = (process.env.ATLAS_APP_BASE_URL || 'http://127.0.0.1:3355').replace(/\/+$/, '');
const API_BASE_URL = `${APP_BASE_URL}/api`;
const USERNAME = process.env.ATLAS_TEST_USERNAME || '';
const PASSWORD = process.env.ATLAS_TEST_PASSWORD || '';
const FISCAL_YEAR = Number(process.env.ATLAS_TEST_FISCAL_YEAR || 2026);
const EXPECTED_VERSION = process.env.ATLAS_EXPECTED_VERSION || '';
const REQUIRE_RELEASE_HASHES = process.env.ATLAS_REQUIRE_RELEASE_HASHES === 'true';
const RUN_MUTATIONS = process.env.ATLAS_RUN_MUTATION_TESTS === 'true';
const RUN_MSSQL_VALIDATION = process.env.ATLAS_RUN_MSSQL_VALIDATION !== 'false';

const dbConfig = {
  server: process.env.DB_SERVER || 'localhost',
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || 'Atlasairfare010',
  user: process.env.DB_USER || 'atlas_user',
  password: process.env.DB_PASSWORD || '',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
  }
};

const reportDir = path.join(__dirname, '..', 'test-reports');
const results = [];
let token = '';
let sessionId = '';
let loggedInUser = null;
let firstCompany = null;
let firstEmployee = null;
let firstLoan = null;
let firstPolicy = null;

function record(name, status, details = {}) {
  results.push({ name, status, details, at: new Date().toISOString() });
}

async function readResponse(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function request(url, options = {}) {
  const headers = {
    ...(options.json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(url, {
    ...options,
    headers,
    body: options.json ? JSON.stringify(options.json) : options.body
  });
  const body = await readResponse(res);
  return { res, body };
}

async function step(name, fn) {
  try {
    const details = await fn();
    record(name, 'PASS', details);
    return details;
  } catch (error) {
    record(name, 'FAIL', { error: error.message });
    throw error;
  }
}

function skip(name, reason, details = {}) {
  record(name, 'SKIP', { reason, ...details });
}

async function expectApiOk(name, apiPath, shapeCheck) {
  return step(name, async () => {
    const { res, body } = await request(`${API_BASE_URL}${apiPath}`);
    assert.ok(res.ok, `${apiPath} expected 2xx, got ${res.status}: ${JSON.stringify(body)}`);
    if (shapeCheck) shapeCheck(body);
    return { status: res.status, path: apiPath, count: Array.isArray(body) ? body.length : undefined };
  });
}

async function expectApiStatus(name, apiPath, expectedStatus, options = {}) {
  return step(name, async () => {
    const { res, body } = await request(`${API_BASE_URL}${apiPath}`, options);
    assert.equal(res.status, expectedStatus, `${apiPath} expected ${expectedStatus}, got ${res.status}: ${JSON.stringify(body)}`);
    return { status: res.status, path: apiPath };
  });
}

async function verifyFrontendRoutes() {
  const routes = [
    { path: '/', label: 'Overview/Dashboard', mustContain: /ATLAS|Airfare|Command Center/i },
    { path: '/employees', label: 'Employees', mustContain: /ATLAS|Airfare/i },
    { path: '/opening-balance', label: 'Opening Balance', mustContain: /ATLAS|Airfare/i },
    { path: `/preferences?fiscalYear=${FISCAL_YEAR}`, label: 'Preferences', mustContain: /Preferences|Settings Command Center|ATLAS HCM/i },
    { path: '/airfare', label: 'Airfare', mustContain: /ATLAS|Airfare/i },
    { path: '/loans', label: 'Loans', mustContain: /ATLAS|Airfare/i },
    { path: '/self-service', label: 'Self-Service', mustContain: /ATLAS|Airfare/i },
    { path: '/reports', label: 'Reports', mustContain: /ATLAS|Airfare/i },
    { path: '/support', label: 'Support/Diagnostics', mustContain: /ATLAS|Airfare/i }
  ];

  for (const route of routes) {
    await step(`Frontend route ${route.label} returns renderable HTML`, async () => {
      const { res, body } = await request(`${APP_BASE_URL}${route.path}`);
      assert.equal(res.status, 200, `${route.path} expected 200, got ${res.status}`);
      assert.match(String(body), route.mustContain, `${route.path} did not contain expected shell text`);
      assert.doesNotMatch(String(body).slice(0, 500), /Internal Server Error|Application error/i, `${route.path} starts with obvious error text`);
      return { status: res.status, path: route.path, bytes: String(body).length };
    });
  }
}

async function verifyPublicRuntime() {
  await step('Version endpoint exposes manifest identity', async () => {
    const { res, body } = await request(`${API_BASE_URL}/version`);
    assert.ok(res.ok, `/api/version expected 2xx, got ${res.status}`);
    assert.equal(body.productCode, 'ATLAS_AIRFARE_ALLOWANCE');
    if (EXPECTED_VERSION) assert.equal(body.version, EXPECTED_VERSION);
    assert.ok(body.frontendBuildHash, 'frontendBuildHash is required');
    assert.ok(body.backendBuildHash, 'backendBuildHash is required');
    assert.ok(body.databaseSchemaVersion, 'databaseSchemaVersion is required');
    if (REQUIRE_RELEASE_HASHES) {
      assert.doesNotEqual(body.frontendBuildHash, 'sha256:pending-build', 'installed release must not expose pending frontend hash');
      assert.doesNotEqual(body.backendBuildHash, 'sha256:pending-build', 'installed release must not expose pending backend hash');
    }
    return {
      status: res.status,
      version: body.version,
      frontendBuildHash: body.frontendBuildHash,
      backendBuildHash: body.backendBuildHash,
      databaseSchemaVersion: body.databaseSchemaVersion
    };
  });

  await step('Health endpoint is reachable and database connected', async () => {
    const { res, body } = await request(`${API_BASE_URL}/health`);
    assert.ok(res.ok, `/api/health expected 2xx, got ${res.status}`);
    assert.ok(body.status, 'health.status is required');
    assert.match(String(body.database || ''), /connected|healthy/i, 'health.database should show connected');
    return { status: res.status, health: body.status, database: body.database };
  });
}

async function loginIfConfigured() {
  if (!USERNAME || !PASSWORD) {
    skip('Authenticated API checks skipped', 'Set ATLAS_TEST_USERNAME and ATLAS_TEST_PASSWORD to run protected API checks.');
    return false;
  }

  await step('Login succeeds', async () => {
    const { res, body } = await request(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      json: { username: USERNAME, password: PASSWORD }
    });
    assert.ok(res.ok, `/api/auth/login expected 2xx, got ${res.status}: ${JSON.stringify(body)}`);
    token = body.token;
    sessionId = body.sessionId;
    loggedInUser = body.user;
    assert.ok(token, 'token is required');
    assert.ok(sessionId, 'sessionId is required');
    return { status: res.status, role: body.user?.role, userId: body.user?.userId };
  });
  return true;
}

async function discoverContext() {
  if (loggedInUser?.role === 'admin') {
    await step('Companies list loads for admin context discovery', async () => {
      const { res, body } = await request(`${API_BASE_URL}/companies`);
      assert.ok(res.ok, `/api/companies expected 2xx, got ${res.status}: ${JSON.stringify(body)}`);
      assert.ok(Array.isArray(body), '/api/companies should return an array');
      firstCompany = body[0] || null;
      return { status: res.status, count: body.length, companyId: firstCompany?.CompanyID || null };
    });
  } else {
    skip('Companies list skipped', 'Only admin users can list companies.', { role: loggedInUser?.role });
  }
}

async function verifyCoreApis() {
  const employeesResult = await expectApiOk('Employees active list loads', '/employees?scope=active', (body) => assert.ok(Array.isArray(body)));
  await expectApiOk('Employees all-scope list loads', '/employees?scope=all', (body) => {
    assert.ok(Array.isArray(body));
    firstEmployee = body[0] || null;
  });
  if (firstEmployee?.EmployeeID) {
    await expectApiOk('Employee detail loads', `/employees/${firstEmployee.EmployeeID}`, (body) => assert.ok(body.EmployeeID));
  } else {
    skip('Employee detail skipped', 'No employee row available for detail verification.');
  }

  await expectApiOk('Airfare policy/rate config loads from MSSQL API', '/airfare-policy-rates', (body) => {
    assert.ok(Array.isArray(body));
    firstPolicy = body[0] || null;
  });
  if (firstPolicy?.PolicyRateID) {
    await expectApiOk('Airfare policy reference guard loads', `/airfare-policy-rates/${firstPolicy.PolicyRateID}/references`, (body) => {
      assert.ok(body && typeof body === 'object');
      assert.ok(Array.isArray(body.references), 'policy references should be an array');
    });
  } else {
    skip('Airfare policy reference guard skipped', 'No airfare policy row available.');
  }

  await expectApiOk('Loan register loads from MSSQL API', '/loans/register', (body) => {
    assert.ok(Array.isArray(body));
    firstLoan = body[0] || null;
  });
  await expectApiOk('Active loan register loads', '/loans/active', (body) => assert.ok(Array.isArray(body)));
  await expectApiOk('Loan summary loads from MSSQL API', '/loans/summary', (body) => {
    assert.ok(body && typeof body === 'object');
    assert.ok('TotalLoans' in body || 'ActiveLoans' in body, 'loan summary should contain totals');
  });
  if (firstLoan?.LoanID) {
    await expectApiOk('Loan detail loads', `/loans/${firstLoan.LoanID}`, (body) => assert.ok(body.LoanID));
    await expectApiOk('Loan history loads', `/loans/${firstLoan.LoanID}/history`, (body) => assert.ok(Array.isArray(body)));
  } else {
    skip('Loan detail/history skipped', 'No loan row available for detail verification.');
  }

  await expectApiOk('Self-service summary loads', '/employee-self-service/summary', (body) => assert.ok(body && typeof body === 'object'));
  await expectApiOk('Self-service requests load', '/employee-self-service/requests', (body) => assert.ok(Array.isArray(body)));
  await expectApiOk('Reports employee master loads', '/reports/employee-master', (body) => assert.ok(Array.isArray(body)));
  await expectApiOk('Reports year summary loads', `/reports/year-summary/${FISCAL_YEAR}`, (body) => assert.ok(body && typeof body === 'object'));
  await expectApiOk('Reports airfare payable loads', `/reports/airfare-payable?year=${FISCAL_YEAR}&asOfDate=${FISCAL_YEAR}-12-31`, (body) => assert.ok(Array.isArray(body)));
  await expectApiOk('Diagnostics database loads', '/diagnostics/database', (body) => assert.ok(body && typeof body === 'object'));
  await expectApiOk('Diagnostics system loads', '/diagnostics/system', (body) => assert.ok(body && typeof body === 'object'));
  await expectApiOk('Diagnostics external APIs loads', '/diagnostics/external-apis', (body) => assert.ok(body && typeof body === 'object'));

  if (loggedInUser?.role === 'admin') {
    await expectApiOk('Continuous entitlement reconciliation loads', `/airfare/entitlement/reconciliation?asOfDate=${FISCAL_YEAR}-12-31&limit=5`, (body) => {
      assert.equal(body.mode, 'migration-reconciliation');
      assert.ok(body.summary && typeof body.summary === 'object');
    });
    await expectApiOk('Continuous entitlement accrual forecast loads', `/entitlement/accrual-forecast?fromDate=${FISCAL_YEAR}-01-01&toDate=${FISCAL_YEAR}-03-31`, (body) => {
      assert.equal(body.mode, 'continuous-entitlement-accrual-forecast');
      assert.ok(Array.isArray(body.rows));
    });
  } else {
    skip('Continuous entitlement admin checks skipped', 'Admin login not available.');
  }

  return employeesResult;
}

function defaultPreferences() {
  return {
    schemaVersion: 3,
    uiOnly: { activeSection: 'appearance', sidebarCollapsed: false, densityPreview: true },
    appearance: { theme: 'system', accentColor: '#0b63f6', density: 'standard', tableRowHeight: 'medium', reduceMotion: false },
    workspace: { defaultLandingPage: 'overview', sidebarCollapsedByDefault: false, rightPanelsVisible: true, compactMetrics: false },
    dataSafety: { requireDestructiveConfirmations: true, confirmBulkDelete: true, exportIncludesUiOnly: false },
    keyboard: { commandPaletteEnabled: true, showShortcutHints: true, shortcuts: [{ id: 'global.search', label: 'Focus search', scope: 'global', keys: ['Ctrl', 'K'], enabled: true }] },
    entitlement: { showProcessPanel: true, showLegacySeedGuidance: true, reconciliationDefaultScope: 'all', accrualForecastHorizonDays: 90, requireAdminForWrites: true },
    notifications: { muteAllWarnings: false, databaseWarnings: true, entitlementWarnings: true, importExportAlerts: true, installerPatchAlerts: true, desktopAlerts: false },
    admin: { apiRateLimitWarningVisible: true, diagnosticsVisible: true, supportBundleExportEnabled: true, showVersionHealth: true },
    metadata: { updatedAt: new Date().toISOString() }
  };
}

async function verifyPreferencesRoundTrip() {
  await step('Preferences load/save/reload round-trip through API', async () => {
    const loaded = await request(`${API_BASE_URL}/preferences?fiscalYear=${FISCAL_YEAR}`);
    assert.ok(loaded.res.ok, `/api/preferences GET expected 2xx, got ${loaded.res.status}: ${JSON.stringify(loaded.body)}`);
    const preferences = loaded.body.preferences || defaultPreferences();
    preferences.schemaVersion = 3;
    preferences.entitlement = { ...(preferences.entitlement || defaultPreferences().entitlement), reconciliationDefaultScope: 'all' };
    preferences.metadata = { ...(preferences.metadata || {}), updatedAt: new Date().toISOString() };
    preferences.uiOnly = { ...(preferences.uiOnly || defaultPreferences().uiOnly), activeSection: 'appearance' };
    preferences.appearance = { ...(preferences.appearance || defaultPreferences().appearance), density: preferences.appearance?.density === 'compact' ? 'standard' : 'compact' };

    const idempotencyKey = `post-patch-smoke-${Date.now()}`;
    const body = {
      fiscalYear: FISCAL_YEAR,
      selectedCompanyId: firstCompany?.CompanyID || loaded.body.selectedCompanyId || null,
      idempotencyKey,
      preferences,
      persisted: {},
      uiOnly: preferences.uiOnly
    };
    const first = await request(`${API_BASE_URL}/preferences`, { method: 'PUT', json: body });
    assert.ok(first.res.ok, `/api/preferences PUT expected 2xx, got ${first.res.status}: ${JSON.stringify(first.body)}`);
    const second = await request(`${API_BASE_URL}/preferences`, { method: 'PUT', json: body });
    assert.ok(second.res.ok, `Repeated idempotent PUT expected 2xx, got ${second.res.status}: ${JSON.stringify(second.body)}`);
    assert.equal(second.body.idempotencyKey, idempotencyKey);
    const reloaded = await request(`${API_BASE_URL}/preferences?fiscalYear=${FISCAL_YEAR}`);
    assert.ok(reloaded.res.ok, `/api/preferences reload expected 2xx, got ${reloaded.res.status}`);
    assert.equal(reloaded.body.preferences?.appearance?.density, preferences.appearance.density, 'reloaded preferences should reflect saved MSSQL-backed value');
    return { getStatus: loaded.res.status, putStatus: first.res.status, idempotencyKey, density: preferences.appearance.density };
  });
}

async function verifyMssqlTruth() {
  if (!RUN_MSSQL_VALIDATION) {
    skip('MSSQL validation skipped', 'ATLAS_RUN_MSSQL_VALIDATION=false');
    return;
  }
  let pool;
  try {
    pool = await sql.connect(dbConfig);
  } catch (error) {
    skip('MSSQL validation skipped', `Could not connect with current DB env: ${error.message}`);
    return;
  }

  try {
    await step('MSSQL schema objects exist for Preferences, Airfare, and Loans', async () => {
      const result = await pool.request().query(`
        SELECT
          OBJECT_ID(N'dbo.UserPreferences', N'U') AS UserPreferencesTable,
          COL_LENGTH(N'dbo.UserPreferences', N'PreferencesJSON') AS PreferencesJsonColumn,
          OBJECT_ID(N'dbo.AirfarePolicyRates', N'U') AS AirfarePolicyRatesTable,
          OBJECT_ID(N'dbo.sp_ATLAS_GetEffectiveAirfarePolicy', N'P') AS EffectiveAirfarePolicyProc,
          OBJECT_ID(N'dbo.Loans', N'U') AS LoansTable,
          OBJECT_ID(N'dbo.LoanHistory', N'U') AS LoanHistoryTable,
          OBJECT_ID(N'dbo.sp_ATLAS_GetLoanRegister', N'P') AS LoanRegisterProc,
          OBJECT_ID(N'dbo.sp_ATLAS_GetLoanSummary', N'P') AS LoanSummaryProc;
      `);
      const row = result.recordset[0];
      for (const [key, value] of Object.entries(row)) {
        assert.ok(value, `${key} is missing`);
      }
      return row;
    });

    await step('MSSQL Airfare policy data is queryable', async () => {
      const result = await pool.request().query(`
        SELECT COUNT_BIG(*) AS PolicyRows
        FROM dbo.AirfarePolicyRates
        WHERE ISNULL(IsDeleted, 0) = 0;
      `);
      return { policyRows: Number(result.recordset[0].PolicyRows || 0) };
    });

    await step('MSSQL Loan register procedures are queryable', async () => {
      const register = await pool.request().query('EXEC dbo.sp_ATLAS_GetLoanRegister @Status = NULL;');
      const summary = await pool.request().query('EXEC dbo.sp_ATLAS_GetLoanSummary;');
      assert.ok(Array.isArray(register.recordset), 'loan register recordset required');
      assert.ok(summary.recordset[0], 'loan summary row required');
      return { registerRows: register.recordset.length, summary: summary.recordset[0] };
    });

    await step('MSSQL PreferencesJSON contains valid JSON when present', async () => {
      const result = await pool.request()
        .input('FiscalYear', sql.Int, FISCAL_YEAR)
        .query(`
          SELECT TOP (20)
              UserID,
              FiscalYear,
              ISJSON(PreferencesJSON) AS IsPreferencesJson,
              UpdatedAt
          FROM dbo.UserPreferences
          WHERE FiscalYear = @FiscalYear
          ORDER BY UpdatedAt DESC;
        `);
      for (const row of result.recordset) {
        if (row.IsPreferencesJson !== null) assert.equal(Number(row.IsPreferencesJson), 1, 'PreferencesJSON must be valid JSON');
      }
      return { rows: result.recordset.length };
    });
  } finally {
    await pool.close();
  }
}

async function verifyMutationGuards() {
  if (!RUN_MUTATIONS) {
    skip('Mutating loan tests skipped', 'Set ATLAS_RUN_MUTATION_TESTS=true only with a controlled QA fixture database.');
    return;
  }
  assert.ok(firstEmployee?.EmployeeID, 'A test employee is required before mutating loan tests can run');
  await step('Loan create mutation works on controlled fixture', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { res, body } = await request(`${API_BASE_URL}/loans`, {
      method: 'POST',
      json: { employeeId: firstEmployee.EmployeeID, amount: 12, tenure: 3, date: today, note: 'ATLAS post-patch QA loan' }
    });
    assert.equal(res.status, 201, `/api/loans create expected 201, got ${res.status}: ${JSON.stringify(body)}`);
    assert.ok(body.LoanID, 'created loan must return LoanID');
    return { loanId: body.LoanID, employeeId: firstEmployee.EmployeeID };
  });
}

async function main() {
  await verifyFrontendRoutes();
  await verifyPublicRuntime();
  const authenticated = await loginIfConfigured();
  if (!authenticated) return;
  await discoverContext();
  await verifyCoreApis();
  await verifyPreferencesRoundTrip();
  await verifyMssqlTruth();
  await verifyMutationGuards();
}

function writeReport() {
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const reportPath = path.join(reportDir, `atlas-post-patch-smoke-${stamp}.json`);
  const failed = results.filter((item) => item.status === 'FAIL').length;
  fs.writeFileSync(reportPath, JSON.stringify({
    appBaseUrl: APP_BASE_URL,
    fiscalYear: FISCAL_YEAR,
    expectedVersion: EXPECTED_VERSION || null,
    requireReleaseHashes: REQUIRE_RELEASE_HASHES,
    runMutations: RUN_MUTATIONS,
    runMssqlValidation: RUN_MSSQL_VALIDATION,
    summary: {
      passed: results.filter((item) => item.status === 'PASS').length,
      skipped: results.filter((item) => item.status === 'SKIP').length,
      failed,
      total: results.length
    },
    results
  }, null, 2));
  console.log(`Post-patch smoke report: ${reportPath}`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(writeReport);
