const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_BASE_URL = (process.env.ATLAS_APP_BASE_URL || 'http://127.0.0.1:3355').replace(/\/+$/, '');
const API_BASE_URL = `${APP_BASE_URL}/api`;
const USERNAME = process.env.ATLAS_TEST_USERNAME || '';
const PASSWORD = process.env.ATLAS_TEST_PASSWORD || '';
const FISCAL_YEAR = Number(process.env.ATLAS_TEST_FISCAL_YEAR || 2026);
const EXPECTED_VERSION = process.env.ATLAS_EXPECTED_VERSION || '';
const RUN_MUTATIONS = process.env.ATLAS_RUN_MUTATION_TESTS === 'true';

const reportDir = path.join(__dirname, '..', 'test-reports');
const results = [];
let token = '';
let sessionId = '';

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
  } catch (error) {
    record(name, 'FAIL', { error: error.message });
    throw error;
  }
}

async function expectOk(name, apiPath, shapeCheck) {
  await step(name, async () => {
    const { res, body } = await request(`${API_BASE_URL}${apiPath}`);
    assert.ok(res.ok, `${apiPath} expected 2xx, got ${res.status}: ${JSON.stringify(body)}`);
    if (shapeCheck) shapeCheck(body);
    return { status: res.status };
  });
}

async function main() {
  await step('Frontend preferences route returns HTML', async () => {
    const { res, body } = await request(`${APP_BASE_URL}/preferences?fiscalYear=${FISCAL_YEAR}`);
    assert.equal(res.status, 200, `Expected /preferences route to be 200, got ${res.status}`);
    assert.match(String(body), /Preferences|ATLAS HCM|Settings Command Center/i);
    return { status: res.status, route: `/preferences?fiscalYear=${FISCAL_YEAR}` };
  });

  await step('Version endpoint exposes manifest identity', async () => {
    const { res, body } = await request(`${API_BASE_URL}/version`);
    assert.ok(res.ok, `/api/version expected 2xx, got ${res.status}`);
    assert.equal(body.productCode, 'ATLAS_AIRFARE_ALLOWANCE');
    if (EXPECTED_VERSION) assert.equal(body.version, EXPECTED_VERSION);
    assert.ok(body.frontendBuildHash, 'frontendBuildHash is required');
    assert.ok(body.backendBuildHash, 'backendBuildHash is required');
    assert.ok(body.databaseSchemaVersion, 'databaseSchemaVersion is required');
    return {
      status: res.status,
      version: body.version,
      frontendBuildHash: body.frontendBuildHash,
      backendBuildHash: body.backendBuildHash,
      databaseSchemaVersion: body.databaseSchemaVersion
    };
  });

  await step('Health endpoint is reachable', async () => {
    const { res, body } = await request(`${API_BASE_URL}/health`);
    assert.ok(res.ok, `/api/health expected 2xx, got ${res.status}`);
    assert.ok(body.status, 'health.status is required');
    return { status: res.status, health: body.status, database: body.database };
  });

  if (!USERNAME || !PASSWORD) {
    record('Authenticated API checks skipped', 'SKIP', {
      reason: 'Set ATLAS_TEST_USERNAME and ATLAS_TEST_PASSWORD to run protected API checks.'
    });
    return;
  }

  await step('Login succeeds', async () => {
    const { res, body } = await request(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      json: { username: USERNAME, password: PASSWORD }
    });
    assert.ok(res.ok, `/api/auth/login expected 2xx, got ${res.status}: ${JSON.stringify(body)}`);
    token = body.token;
    sessionId = body.sessionId;
    assert.ok(token, 'token is required');
    assert.ok(sessionId, 'sessionId is required');
    return { status: res.status, role: body.user?.role };
  });

  await expectOk('Employees list loads from MSSQL API', '/employees?scope=active', (body) => assert.ok(Array.isArray(body)));
  await expectOk('Airfare policy/rate config loads from MSSQL API', '/airfare-policy-rates', (body) => assert.ok(Array.isArray(body)));
  await expectOk('Loan register loads from MSSQL API', '/loans/register', (body) => assert.ok(Array.isArray(body)));
  await expectOk('Loan summary loads from MSSQL API', '/loans/summary', (body) => assert.ok(body && typeof body === 'object'));
  await expectOk('Reports year summary loads', `/reports/year-summary/${FISCAL_YEAR}`, (body) => assert.ok(body && typeof body === 'object'));
  await expectOk('Year End preview is read-only reachable', `/year-end/history?year=${FISCAL_YEAR}`, (body) => assert.ok(Array.isArray(body)));

  await step('Preferences load and idempotent save', async () => {
    const loaded = await request(`${API_BASE_URL}/preferences?fiscalYear=${FISCAL_YEAR}`);
    assert.ok(loaded.res.ok, `/api/preferences GET expected 2xx, got ${loaded.res.status}: ${JSON.stringify(loaded.body)}`);
    const preferences = loaded.body.preferences || {
      schemaVersion: 2,
      uiOnly: { activeSection: 'appearance', sidebarCollapsed: false, densityPreview: true },
      appearance: { theme: 'system', accentColor: '#0b63f6', density: 'standard', tableRowHeight: 'medium', reduceMotion: false },
      workspace: { defaultLandingPage: 'overview', sidebarCollapsedByDefault: false, rightPanelsVisible: true, compactMetrics: false },
      dataSafety: { requireDestructiveConfirmations: true, confirmBulkDelete: true, exportIncludesUiOnly: false },
      keyboard: { commandPaletteEnabled: true, showShortcutHints: true, shortcuts: [{ id: 'global.search', label: 'Focus search', scope: 'global', keys: ['Ctrl', 'K'], enabled: true }] },
      notifications: { muteAllWarnings: false, databaseWarnings: true, yearEndWarnings: true, importExportAlerts: true, installerPatchAlerts: true, desktopAlerts: false },
      admin: { apiRateLimitWarningVisible: true, diagnosticsVisible: true, supportBundleExportEnabled: true, showVersionHealth: true },
      metadata: { updatedAt: new Date().toISOString() }
    };
    const idempotencyKey = `post-patch-smoke-${Date.now()}`;
    const body = {
      fiscalYear: FISCAL_YEAR,
      selectedCompanyId: loaded.body.selectedCompanyId || null,
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
    return { getStatus: loaded.res.status, putStatus: first.res.status, idempotencyKey };
  });

  if (RUN_MUTATIONS) {
    record('Loan mutation test placeholder', 'SKIP', {
      reason: 'Provide a dedicated test employee/allocation fixture before enabling mutating loan tests in production.'
    });
  }
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
