const assert = require('node:assert/strict');

const BASE_URL = process.env.ATLAS_TEST_BASE_URL || 'http://127.0.0.1:3389/v1';
const USERNAME = process.env.ATLAS_TEST_USERNAME || 'sa';
const PASSWORD = process.env.ATLAS_TEST_PASSWORD || 'Atlas@25';

let token = '';
let sessionId = '';

async function request(path, options = {}) {
  const res = await fetch(BASE_URL + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed ${res.status}: ${text}`);
  }
  return body;
}

async function main() {
  const health = await request('/health');
  assert.equal(health.status, 'healthy');
  assert.equal(health.database, 'connected');

  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USERNAME, password: PASSWORD })
  });
  assert.ok(login.token, 'login token missing');
  token = login.token;
  sessionId = login.sessionId;

  const code = `SMK${Date.now().toString().slice(-6)}`;
  const emp = await request('/employees', {
    method: 'POST',
    body: JSON.stringify({
      code,
      name: 'Smoke Test Employee',
      joinDate: '2024-01-01',
      status: 'Active',
      openingDays: 24,
      openingBhd: 60,
      currentAirfare2024: 30,
      remainingBalance2024: 0,
      maximumPayout: 150,
      totalAirfare2024: 135,
      jan: 30, feb: 30, mar: 30, apr: 30, may: 30, jun: 30,
      jul: 30, aug: 30, sep: 30, oct: 30, nov: 30, dec: 30
    })
  });
  assert.ok(emp.EmployeeID, 'employee create did not return EmployeeID');
  assert.equal(Number(emp.OpeningBHD), 60);

  const alloc = await request('/allocations', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: emp.EmployeeID,
      date: '2026-01-01',
      year: 2026,
      ticketCost: 250,
      entitlement: 150,
      companyPaid: 150,
      excess: 100,
      paymentMode: 'loan',
      loanAmount: 100,
      employeePaid: 0,
      companyExtra: 0,
      emi: 10,
      tenure: 10,
      managerApproval: 'Smoke test approval',
      overrideReason: 'Smoke test loan approval',
      remarks: 'Smoke test allocation'
    })
  });
  assert.ok(alloc.AllocationID, 'allocation create did not return AllocationID');

  const loans = await request('/loans/active');
  const loan = loans.find(l => l.EmployeeID === emp.EmployeeID);
  assert.ok(loan, 'loan not created for allocation');

  const loanDelete = await request(`/loans/${loan.LoanID}`, { method: 'DELETE' });
  assert.equal(loanDelete.message, 'Loan deleted');

  const allocDelete = await request(`/allocations/${alloc.AllocationID}`, { method: 'DELETE' });
  assert.equal(allocDelete.message, 'Allocation deleted');

  const empDelete = await request(`/employees/${emp.EmployeeID}`, { method: 'DELETE' });
  assert.equal(empDelete.message, 'Employee deleted');

  const employees = await request('/employees');
  assert.equal(employees.some(e => e.EmployeeCode === code), false, 'deleted employee still visible');

  console.log('ATLAS smoke test passed');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
