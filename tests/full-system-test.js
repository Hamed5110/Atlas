const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
require('dotenv').config();

const BASE_URL = process.env.ATLAS_TEST_BASE_URL || 'http://localhost:3355/api';
const USERNAME = process.env.ATLAS_TEST_USERNAME || 'sa';
const PASSWORD = process.env.ATLAS_TEST_PASSWORD || 'Atlas@25';
const reportDir = path.join(__dirname, '..', 'test-reports');
const YEAR_END_TEST_REMARK = 'QA controlled year-end close test';
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

let token = '';
let sessionId = '';
const startedAt = new Date();
const results = [];
const created = {
  employeeId: null,
  employeeCode: `QA${Date.now().toString().slice(-8)}`,
  userId: null,
  username: `qauser${Date.now().toString().slice(-8)}`,
  companyId: null,
  companyCode: `QAC${Date.now().toString().slice(-7)}`,
  companyDatabase: `ATLAS_QA_${Date.now().toString().slice(-8)}`,
  backupFile: null,
  allocations: [],
  loans: []
};

function addResult(name, status, details = {}) {
  results.push({ name, status, details, at: new Date().toISOString() });
}

async function request(pathname, options = {}) {
  const res = await fetch(BASE_URL + pathname, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${pathname} failed ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function rawRequest(pathname, options = {}) {
  const res = await fetch(BASE_URL + pathname, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${options.method || 'GET'} ${pathname} failed ${res.status}: ${text}`);
  }
  return res;
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function expectedAmount(days, maxPayout = 150) {
  return money((maxPayout / 60) * days);
}

async function testStep(name, fn) {
  try {
    const details = await fn();
    addResult(name, 'PASS', details);
    return details;
  } catch (error) {
    addResult(name, 'FAIL', { error: error.message });
    throw error;
  }
}

async function cleanup() {
  await cleanupYearEndTestHistory();

  if (created.userId) {
    try {
      await request(`/users/${created.userId}`, {
        method: 'PUT',
        body: JSON.stringify({
          password: '',
          email: `${created.username}@example.com`,
          fullName: 'QA Test User',
          role: 'viewer',
          department: 'QA',
          branch: 'ATLAS QA',
          isActive: false
        })
      });
      addResult('Cleanup temporary user by deactivating login', 'PASS', { userId: created.userId, username: created.username });
    } catch (error) {
      addResult('Cleanup temporary user by deactivating login', 'FAIL', { error: error.message, userId: created.userId });
    }
  }

  if (created.employeeId) {
    try {
      await request(`/employees/${created.employeeId}?force=true`, { method: 'DELETE' });
      addResult('Cleanup temporary employee and linked entries', 'PASS', { employeeId: created.employeeId });
    } catch (error) {
      addResult('Cleanup temporary employee and linked entries', 'FAIL', { error: error.message, employeeId: created.employeeId });
    }
  }

  if (created.companyId) {
    try {
      await request(`/companies/${created.companyId}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm: 'DELETE_COMPANY_AND_DATABASE' })
      });
      addResult('Cleanup temporary company and database', 'PASS', { companyId: created.companyId, databaseName: created.companyDatabase });
    } catch (error) {
      addResult('Cleanup temporary company and database', 'FAIL', { error: error.message, companyId: created.companyId, databaseName: created.companyDatabase });
    }
  }

  if (created.backupFile) {
    try {
      if (fs.existsSync(created.backupFile)) fs.rmSync(created.backupFile, { force: true });
      addResult('Cleanup temporary backup file', 'PASS', { backupFile: created.backupFile });
    } catch (error) {
      addResult('Cleanup temporary backup file', 'FAIL', { error: error.message, backupFile: created.backupFile });
    }
  }
}

async function cleanupYearEndTestHistory() {
  let pool;
  try {
    pool = await sql.connect(dbConfig);
    await pool.request()
      .input('Remark', sql.NVarChar(sql.MAX), YEAR_END_TEST_REMARK)
      .query('DELETE FROM YearEndHistory WHERE Remarks = @Remark');
  } catch (error) {
    addResult('Cleanup QA year-end test history', 'FAIL', { error: error.message });
  } finally {
    if (pool) await pool.close();
  }
}

function writeReports() {
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const jsonPath = path.join(reportDir, `atlas-full-system-test-${stamp}.json`);
  const mdPath = path.join(reportDir, `atlas-full-system-test-${stamp}.md`);
  const passed = results.filter((item) => item.status === 'PASS').length;
  const failed = results.filter((item) => item.status === 'FAIL').length;

  fs.writeFileSync(jsonPath, JSON.stringify({
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    testEmployeeCode: created.employeeCode,
    summary: { passed, failed, total: results.length },
    results
  }, null, 2));

  const lines = [
    '# ATLAS Full System Test Report',
    '',
    `- Started: ${startedAt.toISOString()}`,
    `- Finished: ${new Date().toISOString()}`,
    `- API: ${BASE_URL}`,
    `- Test employee: ${created.employeeCode}`,
    `- Result: ${failed ? 'FAILED' : 'PASSED'} (${passed}/${results.length} checks passed)`,
    '',
    '| # | Check | Status | Details |',
    '|---:|---|---|---|',
    ...results.map((item, index) => `| ${index + 1} | ${item.name} | ${item.status} | ${JSON.stringify(item.details).replace(/\|/g, '\\|')} |`)
  ];
  fs.writeFileSync(mdPath, lines.join('\n'));
  return { jsonPath, mdPath, passed, failed };
}

async function main() {
  try {
    await testStep('API health and SQL connection', async () => {
      const health = await request('/health');
      assert.equal(health.status, 'healthy');
      assert.equal(health.database, 'connected');
      return health;
    });

    await testStep('Admin login', async () => {
      const login = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: USERNAME, password: PASSWORD })
      });
      assert.ok(login.token, 'token missing');
      token = login.token;
      sessionId = login.sessionId;
      return { username: login.user.username, role: login.user.role };
    });

    await testStep('Verify date-effective airfare policy rates', async () => {
      const rates = await request('/airfare-policy-rates');
      const oldPolicy = await request('/allocations/eligibility-review?employeeId=12&date=2026-06-17&year=2026');
      const newPolicy = await request('/allocations/eligibility-review?employeeId=12&date=2026-06-18&year=2026');
      assert.ok(Array.isArray(rates), 'policy rate endpoint should return a list');
      assert.ok(Number(oldPolicy.MaximumPayout) > 0, 'old policy maximum payout missing');
      assert.ok(Number(newPolicy.MaximumPayout) > 0, 'new policy maximum payout missing');
      return {
        rateCount: rates.length,
        oldDate: '2026-06-17',
        oldAmount: oldPolicy.MaximumPayout,
        newDate: '2026-06-18',
        newAmount: newPolicy.MaximumPayout
      };
    });

    const testUser = await testStep('Create and verify temporary application user', async () => {
      const user = await request('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: created.username,
          password: 'QaUser@123',
          email: `${created.username}@example.com`,
          fullName: 'QA Test User',
          role: 'viewer',
          department: 'QA',
          branch: 'ATLAS QA',
          isActive: true
        })
      });
      created.userId = user.UserID;
      const users = await request('/users');
      const row = users.find((item) => item.Username === created.username);
      assert.ok(row, 'created user missing from users list');
      assert.equal(row.Role, 'viewer');
      return { userId: user.UserID, username: user.Username, role: user.Role };
    });

    await testStep('Update temporary application user rights/status', async () => {
      const updated = await request(`/users/${testUser.userId}`, {
        method: 'PUT',
        body: JSON.stringify({
          password: '',
          email: `${created.username}@example.com`,
          fullName: 'QA Test User Updated',
          role: 'hr',
          department: 'QA HR',
          branch: 'ATLAS QA',
          isActive: true
        })
      });
      assert.equal(updated.Role, 'hr');
      assert.equal(updated.FullName, 'QA Test User Updated');
      return { userId: updated.UserID, role: updated.Role, department: updated.Department };
    });

    const testCompany = await testStep('Create separate company database with logo', async () => {
      const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="18" fill="#0f6df0"/><text x="48" y="58" text-anchor="middle" font-size="28" font-family="Arial" fill="white">QA</text></svg>`;
      const company = await request('/companies', {
        method: 'POST',
        body: JSON.stringify({
          companyCode: created.companyCode,
          companyName: 'QA Temporary Company',
          databaseName: created.companyDatabase,
          logoMimeType: 'image/svg+xml',
          logoDataBase64: Buffer.from(logoSvg).toString('base64'),
          address: 'QA Address',
          phone: '+97300000000',
          email: `${created.companyCode.toLowerCase()}@example.com`,
          trn: 'QA-TRN',
          contactPerson: 'QA Contact',
          isActive: true
        })
      });
      created.companyId = company.CompanyID;
      const companies = await request('/companies');
      const row = companies.find((item) => item.CompanyID === company.CompanyID);
      assert.ok(row, 'created company missing from companies list');
      assert.equal(row.DatabaseName, created.companyDatabase);
      return { companyId: company.CompanyID, companyCode: company.CompanyCode, databaseName: company.DatabaseName };
    });

    await testStep('Update company details and logo', async () => {
      const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="18" fill="#00947a"/><text x="48" y="58" text-anchor="middle" font-size="24" font-family="Arial" fill="white">OK</text></svg>`;
      const updated = await request(`/companies/${testCompany.companyId}`, {
        method: 'PUT',
        body: JSON.stringify({
          companyCode: created.companyCode,
          companyName: 'QA Temporary Company Updated',
          databaseName: created.companyDatabase,
          logoMimeType: 'image/svg+xml',
          logoDataBase64: Buffer.from(logoSvg).toString('base64'),
          address: 'QA Updated Address',
          phone: '+97311111111',
          email: `${created.companyCode.toLowerCase()}-updated@example.com`,
          trn: 'QA-TRN-UPD',
          contactPerson: 'QA Updated Contact',
          isActive: true
        })
      });
      assert.equal(updated.CompanyName, 'QA Temporary Company Updated');
      const logo = await rawRequest(`/companies/${testCompany.companyId}/logo`);
      assert.ok((logo.headers.get('content-type') || '').includes('image/svg+xml'));
      const bytes = Buffer.from(await logo.arrayBuffer());
      assert.ok(bytes.length > 50, 'logo response was empty');
      return { companyId: updated.CompanyID, companyName: updated.CompanyName, logoBytes: bytes.length };
    });

    await testStep('Create backup for temporary company database', async () => {
      const backup = await request('/admin/backup', {
        method: 'POST',
        body: JSON.stringify({ databaseName: created.companyDatabase })
      });
      created.backupFile = backup.backupFile;
      assert.equal(backup.databaseName, created.companyDatabase);
      assert.ok(fs.existsSync(backup.backupFile), 'backup file was not created');
      return { databaseName: backup.databaseName, backupFile: backup.backupFile };
    });

    await testStep('Restore temporary company database from backup', async () => {
      const restored = await request('/admin/restore', {
        method: 'POST',
        body: JSON.stringify({
          databaseName: created.companyDatabase,
          backupFile: created.backupFile,
          confirm: 'RESTORE'
        })
      });
      assert.equal(restored.restored, true);
      assert.equal(restored.databaseName, created.companyDatabase);
      return restored;
    });

    const employee = await testStep('Create temporary employee master entry', async () => {
      const emp = await request('/employees', {
        method: 'POST',
        body: JSON.stringify({
          code: created.employeeCode,
          name: 'QA Full Test Employee',
          joinDate: '2025-01-01',
          department: 'QA Department',
          branch: 'ATLAS QA',
          nationality: 'TEST',
          whatsappNumber: '97333334444',
          status: 'Active',
          openingDays: 0,
          openingBhd: 0,
          currentAirfare2024: 0,
          airfarePaidDays: 0,
          remainingBalance2024: 0,
          maximumPayout: 150,
          totalAirfare2024: 0,
          totalWorkingDays: 360,
          jan: 30, feb: 30, mar: 30, apr: 30, may: 30, jun: 30,
          jul: 30, aug: 30, sep: 30, oct: 30, nov: 30, dec: 30
        })
      });
      assert.ok(emp.EmployeeID, 'employee id missing');
      assert.equal(emp.WhatsAppNumber, '97333334444');
      created.employeeId = emp.EmployeeID;
      return { employeeId: emp.EmployeeID, employeeCode: emp.EmployeeCode, whatsappNumber: emp.WhatsAppNumber };
    });

    await testStep('Save opening balance value entry', async () => {
      const saved = await request('/opening-balances', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: employee.employeeId,
          year: 2026,
          openingDays: 25,
          openingBhd: 62.5,
          maximumPayout: 150
        })
      });
      assert.equal(Number(saved.OpeningDays), 25);
      assert.equal(Number(saved.OpeningBHD), 62.5);
      return { openingDays: saved.OpeningDays, openingBhd: saved.OpeningBHD };
    });

    await testStep('Verify opening balance report/list', async () => {
      const balances = await request('/opening-balances?year=2026');
      const row = balances.find((item) => item.EmployeeCode === created.employeeCode);
      assert.ok(row, 'opening balance row missing');
      assert.equal(Number(row.OpeningDays), 25);
      assert.equal(Number(row.OpeningBHD), 62.5);
      return { rowFound: true, openingDays: row.OpeningDays, openingBhd: row.OpeningBHD };
    });

    await testStep('Verify employee payable formula values', async () => {
      const employees = await request('/employees');
      const row = employees.find((item) => item.EmployeeCode === created.employeeCode);
      assert.ok(row, 'employee missing after opening balance save');
      assert.equal(Number(row.ClosingBalanceDays), 25);
      assert.equal(Number(row.ClosingBalanceBHD), expectedAmount(25, 150));
      return { closingDays: row.ClosingBalanceDays, amount: row.ClosingBalanceBHD, formula: '150 / 60 * 25 = 62.50' };
    });

    const entitlementAllocation = await testStep('Create airfare allocation fully paid by company entitlement', async () => {
      const alloc = await request('/allocations', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: employee.employeeId,
          date: '2026-06-14',
          year: 2026,
          ticketCost: 50,
          entitlement: 62.5,
          companyPaid: 50,
          excess: 0,
          paymentMode: 'entitlement',
          loanAmount: 0,
          employeePaid: 0,
          emi: 0,
          tenure: 0,
          leaveStart: '2026-07-01',
          leaveEnd: '2026-07-30',
          remarks: 'QA entitlement allocation'
        })
      });
      created.allocations.push(alloc.AllocationID);
      assert.equal(Number(alloc.CompanyPaid), 50);
      assert.equal(Number(alloc.ExcessAmount), 0);
      return { allocationId: alloc.AllocationID, companyPaid: alloc.CompanyPaid, excess: alloc.ExcessAmount };
    });

    await testStep('Upload and list allocation attachment', async () => {
      const uploaded = await request(`/allocations/${entitlementAllocation.allocationId}/attachments`, {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'qa-ticket.pdf',
          mimeType: 'application/pdf',
          dataBase64: Buffer.from('%PDF-1.4 ATLAS QA ticket').toString('base64')
        })
      });
      assert.equal(uploaded.FileName, 'qa-ticket.pdf');
      const listed = await request(`/allocations/${entitlementAllocation.allocationId}/attachments`);
      assert.equal(listed.length, 1);
      return { attachmentId: uploaded.AttachmentID, listed: listed.length };
    });

    await testStep('Verify duplicate-ticket entitlement excludes opening balance', async () => {
      const review = await request(`/allocations/eligibility-review?employeeId=${employee.employeeId}&date=2026-06-15&year=2026`);
      assert.ok(review.PreviousAllocationDate, 'previous ticket date should be returned');
      assert.ok(Number(review.CurrentYearEarnedAmount) > 0, 'current earning since previous ticket should be calculated');
      assert.equal(Number(review.AirfareEntitlementAmount), 0);
      return {
        previousTicketDate: review.PreviousAllocationDate,
        currentYearEarnedAmount: review.CurrentYearEarnedAmount,
        alreadyPaidAmount: review.AlreadyPaidAmount,
        airfareEntitlementAmount: review.AirfareEntitlementAmount
      };
    });

    await testStep('Create airfare allocation with employee self-pay excess', async () => {
      const alloc = await request('/allocations', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: employee.employeeId,
          date: '2026-06-15',
          year: 2026,
          ticketCost: 80,
          entitlement: 62.5,
          companyPaid: 62.5,
          excess: 17.5,
          paymentMode: 'employee',
          loanAmount: 0,
          employeePaid: 17.5,
          emi: 0,
          tenure: 0,
          remarks: 'QA employee self-pay allocation',
          overrideReason: 'QA duplicate-ticket review',
          managerApproval: 'QA manager approval for second ticket'
        })
      });
      created.allocations.push(alloc.AllocationID);
      assert.equal(Number(alloc.TicketCost), 80);
      assert.ok(Number(alloc.CompanyPaid) >= 0);
      assert.ok(Number(alloc.EmployeePaid) >= 0);
      assert.ok((Number(alloc.CompanyPaid) + Number(alloc.EmployeePaid)) <= 80 + 0.0001);
      assert.equal(Number(alloc.LoanAmount), 0);
      return { allocationId: alloc.AllocationID, companyPaid: alloc.CompanyPaid, employeePaid: alloc.EmployeePaid };
    });

    await testStep('Block loan allocation without manager approval', async () => {
      try {
        await request('/allocations', {
          method: 'POST',
          body: JSON.stringify({
            employeeId: employee.employeeId,
            date: '2026-06-16',
            year: 2026,
            ticketCost: 100,
            entitlement: 62.5,
            companyPaid: 62.5,
            excess: 37.5,
            paymentMode: 'loan',
            loanAmount: 37.5,
            employeePaid: 0,
            emi: 6.25,
            tenure: 6,
            remarks: 'QA loan allocation without manager approval',
            overrideReason: 'QA missing approval should fail'
          })
        });
      } catch (error) {
        assert.match(error.message, /428/, 'loan without manager approval should be blocked with 428');
        assert.match(error.message, /ALLOCATION_LOAN_MANAGER_APPROVAL/, 'loan approval error code should be returned');
        return { blocked: true, rule: 'loan requires manager approval' };
      }
      throw new Error('loan allocation without manager approval was accepted');
    });

    await testStep('Create airfare allocation with excess loan', async () => {
      const alloc = await request('/allocations', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: employee.employeeId,
          date: '2026-06-16',
          year: 2026,
          ticketCost: 100,
          entitlement: 62.5,
          companyPaid: 62.5,
          excess: 37.5,
          paymentMode: 'loan',
          loanAmount: 37.5,
          employeePaid: 0,
          emi: 6.25,
          tenure: 6,
          remarks: 'QA loan allocation',
          overrideReason: 'QA duplicate-ticket loan review',
          managerApproval: 'QA manager approval for loan ticket'
        })
      });
      created.allocations.push(alloc.AllocationID);
      assert.equal(Number(alloc.LoanAmount), 37.5);
      return { allocationId: alloc.AllocationID, loanAmount: alloc.LoanAmount, emi: alloc.EMI };
    });

    await testStep('Verify active loan register values', async () => {
      const loans = await request('/loans/register');
      const loan = loans.find((item) => item.EmployeeCode === created.employeeCode && Number(item.OriginalAmount) === 37.5);
      assert.ok(loan, 'loan register row missing');
      created.loans.push(loan.LoanID);
      assert.equal(Number(loan.EMI), 6.25);
      assert.equal(Number(loan.RemainingBalance), 37.5);
      return { loanId: loan.LoanID, originalAmount: loan.OriginalAmount, emi: loan.EMI, remaining: loan.RemainingBalance };
    });

    const operationsLoan = await testStep('Create manual loan for deferment, restructure, settlement workflow', async () => {
      const loan = await request('/loans', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: created.employeeId,
          amount: 60,
          tenure: 6,
          date: '2026-06-20',
          note: 'QA loan operations workflow'
        })
      });
      created.loans.push(loan.LoanID);
      assert.equal(Number(loan.EMI), 10);
      return { loanId: loan.LoanID, emi: loan.EMI, remaining: loan.RemainingBalance };
    });

    await testStep('Preview and run selected monthly EMI with confirmation', async () => {
      const preview = await request('/loans/run-emis/preview', {
        method: 'POST',
        body: JSON.stringify({ loanIds: [operationsLoan.loanId], paymentDate: '2026-06-21' })
      });
      assert.equal(Number(preview.processed), 1);
      assert.equal(Number(preview.totalDeducted), 10);
      const run = await request('/loans/run-emis', {
        method: 'POST',
        body: JSON.stringify({ loanIds: [operationsLoan.loanId], paymentDate: '2026-06-21', confirm: 'RUN_EMI' })
      });
      assert.equal(Number(run.processed), 1);
      assert.equal(Number(run.totalDeducted), 10);
      return { previewed: preview.processed, processed: run.processed, totalDeducted: run.totalDeducted };
    });

    await testStep('Preview and return wrong monthly EMI with SQL history', async () => {
      const preview = await request('/loans/reverse-emis/preview', {
        method: 'POST',
        body: JSON.stringify({ loanIds: [operationsLoan.loanId] })
      });
      assert.equal(Number(preview.selected), 1);
      assert.equal(Number(preview.reversible), 1);
      assert.equal(Number(preview.totalReturned), 10);
      const returned = await request('/loans/reverse-emis', {
        method: 'POST',
        body: JSON.stringify({
          loanIds: [operationsLoan.loanId],
          reversalDate: '2026-06-21',
          note: 'QA wrong EMI return',
          confirm: 'REVERSE_EMI'
        })
      });
      assert.equal(Number(returned.processed), 1);
      assert.equal(Number(returned.totalReturned), 10);
      const loan = await request(`/loans/${operationsLoan.loanId}`);
      assert.equal(Number(loan.RemainingBalance), 60);
      assert.equal(Number(loan.TotalPaid), 0);
      assert.equal(Number(loan.MonthsPaid), 0);
      const history = await request(`/loans/${operationsLoan.loanId}/history`);
      assert.ok(history.some((row) => row.PaymentType === 'reversal'), 'EMI reversal history missing');
      return { loanId: operationsLoan.loanId, returned: returned.totalReturned, remaining: loan.RemainingBalance };
    });

    await testStep('Re-run monthly EMI after wrong EMI return', async () => {
      const run = await request('/loans/run-emis', {
        method: 'POST',
        body: JSON.stringify({ loanIds: [operationsLoan.loanId], paymentDate: '2026-06-21', confirm: 'RUN_EMI' })
      });
      assert.equal(Number(run.processed), 1);
      assert.equal(Number(run.totalDeducted), 10);
      const loan = await request(`/loans/${operationsLoan.loanId}`);
      assert.equal(Number(loan.RemainingBalance), 50);
      assert.equal(Number(loan.TotalPaid), 10);
      assert.equal(Number(loan.MonthsPaid), 1);
      return { loanId: operationsLoan.loanId, processed: run.processed, totalDeducted: run.totalDeducted };
    });

    await testStep('Restructure loan EMI with SQL history', async () => {
      const result = await request(`/loans/${operationsLoan.loanId}/restructure`, {
        method: 'POST',
        body: JSON.stringify({
          newEmi: 25,
          effectiveDate: '2026-06-22',
          note: 'QA EMI restructure',
          confirm: 'RESTRUCTURE'
        })
      });
      assert.equal(Number(result.loan.EMI), 25);
      const history = await request(`/loans/${operationsLoan.loanId}/history`);
      assert.ok(history.some((row) => row.PaymentType === 'restructure'), 'restructure history missing');
      return { loanId: operationsLoan.loanId, newEmi: result.loan.EMI };
    });

    await testStep('Defer loan EMI holiday with SQL history', async () => {
      const result = await request(`/loans/${operationsLoan.loanId}/defer`, {
        method: 'POST',
        body: JSON.stringify({
          deferMonths: 2,
          deferStart: '2026-06-23',
          note: 'QA EMI holiday',
          confirm: 'DEFER'
        })
      });
      assert.equal(result.loan.Status, 'deferred');
      assert.equal(Number(result.loan.DeferMonths), 2);
      const history = await request(`/loans/${operationsLoan.loanId}/history`);
      assert.ok(history.some((row) => row.PaymentType === 'defer'), 'defer history missing');
      return { loanId: operationsLoan.loanId, status: result.loan.Status, deferMonths: result.loan.DeferMonths };
    });

    await testStep('Settle loan early payoff with confirmation', async () => {
      const result = await request(`/loans/${operationsLoan.loanId}/settle`, {
        method: 'POST',
        body: JSON.stringify({
          settlementDate: '2026-06-24',
          note: 'QA early payoff',
          confirm: 'SETTLE'
        })
      });
      assert.equal(result.loan.Status, 'settled');
      assert.equal(Number(result.loan.RemainingBalance), 0);
      return { loanId: operationsLoan.loanId, status: result.loan.Status, remaining: result.loan.RemainingBalance };
    });

    await testStep('Verify allocation register and year summary reports', async () => {
      const allocations = await request('/allocations?year=2026');
      const rows = allocations.filter((item) => item.EmployeeCode === created.employeeCode);
      assert.equal(rows.length, 3);
      const summary = await request('/reports/year-summary/2026');
      assert.ok(summary.allocations.TotalAllocations >= 3);
      return {
        qaAllocations: rows.length,
        totalTicketsForQa: money(rows.reduce((sum, item) => sum + Number(item.TicketCost || 0), 0)),
        totalCompanyPaidForQa: money(rows.reduce((sum, item) => sum + Number(item.CompanyPaid || 0), 0)),
        yearSummaryAllocations: summary.allocations.TotalAllocations
      };
    });

    await testStep('Verify employee master report includes test employee', async () => {
      const report = await request('/reports/employee-master');
      const row = report.find((item) => item.EmployeeCode === created.employeeCode);
      assert.ok(row, 'employee master report row missing');
      assert.equal(Number(row.ClosingBalanceBHD), 62.5);
      return { reportRows: report.length, testEmployeeAmount: row.ClosingBalanceBHD };
    });

    await testStep('Verify Airfare Payable report uses current-year 30 days / 75 BHD rule for all active employees', async () => {
      const report = await request('/reports/airfare-payable?year=2026&asOfDate=2026-06-18');
      const employees = await request('/employees');
      const activeEmployees = employees.filter((item) => (item.Status || 'Active') === 'Active');
      const row = report.find((item) => item.EmployeeCode === created.employeeCode);
      assert.ok(row, 'test employee missing from Airfare Payable report');
      assert.ok(report.length >= activeEmployees.length, 'Airfare Payable report should include all active employees');
      assert.equal(Number(row.AnnualEntitlementDays), 30);
      assert.equal(Number(row.AnnualEntitlementBHD), 75);
      assert.equal(Number(row.PerDayRate), 2.5);
      assert.ok(Number(row.PayableBHD) >= 0, 'payable cannot be negative');
      assert.ok(Object.prototype.hasOwnProperty.call(row, 'AirfareEntitlementAmount'), 'Airfare entitlement amount column missing');
      const eligibility = await request(`/allocations/eligibility-review?employeeId=${created.employeeId}&date=2026-06-18&year=2026`);
      const expectedEntitlement = Math.min(Number(eligibility.AirfareEntitlementAmount), Number(row.MaximumPayoutCap || 150));
      assert.equal(Number(row.AirfareEntitlementAmount), expectedEntitlement, 'Airfare entitlement amount should match Airfare screen logic capped by max payout');
      assert.ok(Number(row.AirfareEntitlementAmount) <= Number(row.MaximumPayoutCap || 150), 'Airfare entitlement amount should not exceed max payout cap');
      const expectedPayable = money(Number(row.BalanceDays || 0) * Number(row.PerDayRate || 2.5));
      assert.equal(money(row.PayableBHD), expectedPayable, 'Payable amount should show the full opening plus current-year available balance');
      assert.ok(Number(row.PayableBHD) >= Number(row.AirfareEntitlementAmount), 'Payable amount should not be lower than capped entitlement');
      return {
        rows: report.length,
        activeEmployees: activeEmployees.length,
        annualDays: row.AnnualEntitlementDays,
        annualAmount: row.AnnualEntitlementBHD,
        perDayRate: row.PerDayRate,
        maxPayoutCap: row.MaximumPayoutCap,
        testEmployeeEntitlementAmount: row.AirfareEntitlementAmount,
        screenEntitlementAmount: eligibility.AirfareEntitlementAmount,
        testEmployeePayable: row.PayableBHD
      };
    });

    await testStep('Verify Airfare Payable report status adjusts after ticket processing', async () => {
      const allocation = await request('/allocations', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: created.employeeId,
          date: '2026-06-19',
          year: 2026,
          ticketCost: 40,
          paymentMode: 'company',
          decision: 'process',
          overrideReason: 'QA processed ticket status check',
          managerApproval: 'QA approval',
          emergency: false,
          loanTenureMonths: 6,
          leaveStart: '2026-06-19',
          leaveEnd: '2026-06-20',
          route: 'BAH - QA - BAH',
          ticketNo: `QATKT${Date.now().toString().slice(-5)}`,
          supplier: 'QA Travel',
          invoiceNo: `QAINV${Date.now().toString().slice(-5)}`,
          remarks: 'QA report status ticket'
        })
      });
      assert.equal(allocation.PaymentMode, 'company');
      assert.ok(Number(allocation.CompanyPaid || 0) > 0, 'Paid by Company should save a company-paid amount');
      const report = await request('/reports/airfare-payable?year=2026&asOfDate=2026-06-20');
      const row = report.find((item) => item.EmployeeCode === created.employeeCode);
      assert.ok(row, 'processed employee missing from Airfare Payable report');
      assert.match(String(row.VerificationNote || ''), /Ticket processed/, 'processed ticket should update report status');
      assert.ok(Number(row.AirfareEntitlementAmount) <= Number(row.MaximumPayoutCap || 150), 'processed ticket entitlement should stay within max payout cap');
      return {
        status: row.VerificationNote,
        companyPaid: allocation.CompanyPaid,
        excess: allocation.ExcessAmount,
        entitlementAmount: row.AirfareEntitlementAmount,
        maxPayoutCap: row.MaximumPayoutCap
      };
    });

    await testStep('Create airfare allocation with full company-paid exception', async () => {
      const ticketCost = 125;
      const allocation = await request('/allocations', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: created.employeeId,
          date: '2026-06-20',
          year: 2026,
          ticketCost,
          paymentMode: 'company_full',
          decision: 'process',
          overrideReason: 'QA full company-paid exception',
          managerApproval: 'QA full company approval',
          emergency: false,
          loanTenureMonths: 6,
          leaveStart: '2026-06-20',
          leaveEnd: '2026-06-21',
          route: 'BAH - QA FULL - BAH',
          ticketNo: `QAFULL${Date.now().toString().slice(-5)}`,
          supplier: 'QA Travel',
          invoiceNo: `QAFULLINV${Date.now().toString().slice(-5)}`,
          remarks: 'QA full company-paid ticket'
        })
      });
      assert.equal(allocation.PaymentMode, 'company_full');
      assert.equal(Number(allocation.CompanyPaid), ticketCost);
      assert.equal(Number(allocation.CompanyExtra || 0), Number((ticketCost - Number(allocation.Entitlement || 0)).toFixed(2)));
      assert.equal(Number(allocation.EmployeePaid || 0), 0);
      assert.equal(Number(allocation.LoanAmount || 0), 0);
      assert.equal(Number(allocation.ExcessAmount || 0), 0);
      return {
        allocationId: allocation.AllocationID,
        paymentMode: allocation.PaymentMode,
        companyPaid: allocation.CompanyPaid,
        ticketCost: allocation.TicketCost
      };
    });

    await testStep('Run Phase 2 SQL system verification', async () => {
      const verification = await request('/intelligence/verification?year=2026');
      assert.ok(verification.summary, 'verification summary missing');
      assert.ok(Array.isArray(verification.checks), 'verification checks missing');
      assert.ok(Number(verification.summary.TotalChecks) >= 8, 'expected multiple verification checks');
      const codes = new Set(verification.checks.map((item) => item.CheckCode));
      assert.ok(codes.has('ALLOCATION_AMOUNT_RECONCILIATION'), 'allocation reconciliation check missing');
      assert.ok(codes.has('OPENING_AMOUNT_SYSTEM_CALC'), 'opening balance formula check missing');
      assert.ok(codes.has('REPORT_DRILLDOWN_REFERENTIAL_LINKS'), 'report link check missing');
      assert.ok(codes.has('AIRFARE_PAYABLE_CURRENT_YEAR_RULE'), 'Airfare Payable yearly rule check missing');
      assert.ok(codes.has('REPORT_SUBTOTAL_GRAND_TOTAL_SOURCE'), 'report subtotal/grand-total source check missing');
      assert.ok(codes.has('REPORT_NUMERIC_DAYS_AMOUNT_LAYOUT'), 'report numeric days/amount layout check missing');
      assert.ok(codes.has('REPORT_SCREEN_READABILITY_LAYOUT'), 'report screen readability check missing');
      assert.ok(codes.has('RETRACTABLE_SHELL_PANELS'), 'retractable shell panels check missing');
      assert.ok(codes.has('APPEARANCE_THEME_DENSITY_CONTROLS'), 'appearance theme and density check missing');
      return {
        status: verification.summary.VerificationStatus,
        score: verification.summary.VerificationScore,
        checks: verification.summary.TotalChecks,
        failed: verification.summary.FailedChecks,
        warnings: verification.summary.WarningChecks
      };
    });

    const startingYearEnd = new Date().getFullYear() + 2;
    let yearEndYear = startingYearEnd;

    await cleanupYearEndTestHistory();

    await testStep('Save future opening balance for year-end test', async () => {
      const saved = await request('/opening-balances', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: employee.employeeId,
          year: yearEndYear,
          openingDays: 12,
          openingBhd: 30,
          maximumPayout: 150
        })
      });
      assert.equal(Number(saved.OpeningDays), 12);
      assert.equal(Number(saved.OpeningBHD), 30);
      return { year: yearEndYear, openingDays: saved.OpeningDays, openingBhd: saved.OpeningBHD };
    });

    await testStep('Preview and close year-end process for temporary employee', async () => {
      let closed = null;
      let preview = null;
      const expectedClosingDays = 42;
      const expectedClosingBhd = expectedAmount(expectedClosingDays, 150);
      while (yearEndYear <= 2100) {
        preview = await request(`/year-end/preview/${yearEndYear}?employeeId=${employee.employeeId}&closingDate=${yearEndYear}-12-31`);
        assert.equal(preview.employeeCount, 1);
        assert.equal(Number(preview.totalClosingDays), expectedClosingDays);
        assert.equal(Number(preview.totalOpeningBalance), expectedClosingBhd);
        assert.ok(Number(preview.pendingLoanCount) >= 0, 'pending loan count missing from year-end preview');
        assert.ok(Number(preview.pendingLoanAmount) >= 0, 'pending loan amount missing from year-end preview');
        assert.equal(Number(preview.employees[0].ClosingDays), expectedClosingDays);
        assert.equal(Number(preview.employees[0].ClosingBHD), expectedClosingBhd);
        try {
          closed = await request('/year-end/close', {
            method: 'POST',
            body: JSON.stringify({
              year: yearEndYear,
              closingDate: `${yearEndYear}-12-31`,
              employeeId: employee.employeeId,
              remarks: YEAR_END_TEST_REMARK
            })
          });
          break;
        } catch (error) {
          if (String(error.message).includes('YEAR_END_ALREADY_CLOSED') && yearEndYear < 2100) {
            yearEndYear += 1;
            await request('/opening-balances', {
              method: 'POST',
              body: JSON.stringify({
                employeeId: employee.employeeId,
                year: yearEndYear,
                openingDays: 12,
                openingBhd: 30,
                maximumPayout: 150
              })
            });
            continue;
          }
          throw error;
        }
      }

      assert.ok(closed, 'year end close did not complete');
      assert.ok(closed.yearEndId, 'year end history id missing');
      assert.equal(closed.employeeCount, 1);
      assert.equal(Number(closed.totalClosingDays), expectedClosingDays);
      assert.equal(Number(closed.totalOpeningBalance), expectedClosingBhd);
      assert.ok(Number(closed.pendingLoanCount) >= 0, 'pending loan count missing from year-end close');

      const nextYear = await request(`/opening-balances?year=${yearEndYear + 1}`);
      const row = nextYear.find((item) => item.EmployeeID === employee.employeeId);
      assert.ok(row, 'next year opening balance was not carried');
      assert.equal(Number(row.OpeningDays), expectedClosingDays);
      assert.equal(Number(row.OpeningBHD), expectedClosingBhd);
      return { yearEndId: closed.yearEndId, yearEndYear, carriedToYear: yearEndYear + 1, openingDays: row.OpeningDays, openingBhd: row.OpeningBHD };
    });
  } finally {
    await cleanup();
    const report = writeReports();
    console.log(`ATLAS full system test ${report.failed ? 'FAILED' : 'PASSED'}`);
    console.log(`Markdown report: ${report.mdPath}`);
    console.log(`JSON report: ${report.jsonPath}`);
    if (report.failed) process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
