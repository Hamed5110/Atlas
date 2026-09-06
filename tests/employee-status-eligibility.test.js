const assert = require('assert/strict');
const sql = require('mssql');

const BASE_URL = process.env.ATLAS_TEST_URL || 'http://127.0.0.1:3389/v1';
const USERNAME = process.env.ATLAS_TEST_USER || 'sa';
const PASSWORD = process.env.ATLAS_TEST_PASSWORD || 'Atlas@25';
const YEAR = Number(process.env.ATLAS_TEST_YEAR || new Date().getFullYear());
const AS_OF_DATE = process.env.ATLAS_TEST_AS_OF || `${YEAR}-06-21`;
const RUN_ID = `${Date.now()}`.slice(-8);

const dbConfig = {
  server: process.env.SQL_SERVER || 'localhost',
  database: process.env.SQL_DATABASE || 'Atlasairfare010',
  user: process.env.SQL_USER || 'sa',
  password: process.env.SQL_PASSWORD || 'Atlas@25',
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 120000
};

async function api(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${options.method || 'GET'} ${path} failed ${res.status}: ${text}`);
  }
  return res.json();
}

async function cleanup(pool, codes) {
  for (const code of codes) {
    await pool.request()
      .input('EmployeeCode', sql.NVarChar(20), code)
      .query('DELETE FROM dbo.Employees WHERE EmployeeCode = @EmployeeCode');
  }
}

async function main() {
  const cases = [
    ['Active', true],
    ['Resign', false],
    ['Separated', false],
    ['Probation', false],
    ['Inactive', false],
    ['In-active', false]
  ];
  const codes = cases.map(([status], index) => `TST${RUN_ID}${index}`.slice(0, 20));
  const pool = await sql.connect(dbConfig);

  try {
    await cleanup(pool, codes);
    for (let index = 0; index < cases.length; index += 1) {
      const [status] = cases[index];
      await pool.request()
        .input('EmployeeCode', sql.NVarChar(20), codes[index])
        .input('FullName', sql.NVarChar(120), `Eligibility ${status} ${RUN_ID}`)
        .input('JoinDate', sql.Date, `${YEAR}-01-01`)
        .input('Department', sql.NVarChar(50), 'QA Status')
        .input('Status', sql.NVarChar(20), status)
        .input('MaximumPayout', sql.Decimal(10, 2), 150)
        .query(`
          INSERT INTO dbo.Employees (EmployeeCode, FullName, JoinDate, Department, Status, MaximumPayout)
          VALUES (@EmployeeCode, @FullName, @JoinDate, @Department, @Status, @MaximumPayout)
        `);
    }

    const session = await api('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD })
    });
    const auth = {
      Authorization: `Bearer ${session.token}`,
      'X-Session-Id': session.sessionId
    };

    const employees = await api('/employees?scope=active', { headers: auth });
    const allEmployees = await api('/employees?scope=all', { headers: auth });
    const inactiveEmployees = await api('/employees?scope=inactive', { headers: auth });
    const report = await api(`/reports/airfare-payable?year=${YEAR}&asOfDate=${AS_OF_DATE}`, { headers: auth });
    const employeeCodes = new Set(employees.map((row) => row.EmployeeCode));
    const allEmployeeCodes = new Set(allEmployees.map((row) => row.EmployeeCode));
    const inactiveEmployeeCodes = new Set(inactiveEmployees.map((row) => row.EmployeeCode));
    const reportCodes = new Set(report.map((row) => row.EmployeeCode));

    cases.forEach(([, shouldAppear], index) => {
      assert.equal(employeeCodes.has(codes[index]), shouldAppear, `${codes[index]} employee list eligibility mismatch`);
      assert.equal(reportCodes.has(codes[index]), shouldAppear, `${codes[index]} Airfare Payable eligibility mismatch`);
      assert.equal(allEmployeeCodes.has(codes[index]), true, `${codes[index]} all-scope employee master mismatch`);
      assert.equal(inactiveEmployeeCodes.has(codes[index]), !shouldAppear, `${codes[index]} inactive-scope employee master mismatch`);
    });

    console.log(JSON.stringify({
      status: 'employee-status-eligibility-passed',
      checkedStatuses: cases.map(([status]) => status),
      activeIncluded: codes[0],
      excludedCount: cases.length - 1
    }));
  } finally {
    await cleanup(pool, codes);
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
