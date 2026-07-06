const assert = require('assert/strict');
const sql = require('mssql');

const RUN_ID = String(Date.now()).slice(-8);
const dbConfig = {
  server: process.env.SQL_SERVER || 'localhost',
  database: process.env.SQL_DATABASE || 'Atlasairfare010',
  user: process.env.SQL_USER || 'sa',
  password: process.env.SQL_PASSWORD || 'Atlas@25',
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 120000
};

async function main() {
  const pool = await sql.connect(dbConfig);
  const companyCode = 'TPC' + RUN_ID.slice(-5);
  const employeeCode = 'TPE' + RUN_ID.slice(-5);
  const payGroupEmployeeCode = 'TPG' + RUN_ID.slice(-5);
  const deptEmployeeCode = 'TPD' + RUN_ID.slice(-5);
  const department = 'Policy Dept ' + RUN_ID.slice(-4);
  const payGroup = 'PG' + RUN_ID.slice(-4);
  const employeePreferenceAmount = 175 + (Number(RUN_ID.slice(-2)) % 25);
  let companyId = null;
  let employeeId = null;
  let payGroupEmployeeId = null;
  let deptEmployeeId = null;
  try {
    const company = await pool.request()
      .input('CompanyCode', sql.NVarChar(20), companyCode)
      .input('CompanyName', sql.NVarChar(120), 'Temp Policy Company ' + RUN_ID)
      .input('DatabaseName', sql.NVarChar(128), 'TMP_POLICY_' + RUN_ID)
      .query('INSERT INTO dbo.Companies (CompanyCode, CompanyName, DatabaseName, IsActive) OUTPUT INSERTED.CompanyID VALUES (@CompanyCode, @CompanyName, @DatabaseName, 1)');
    companyId = company.recordset[0].CompanyID;

    const employee = await pool.request()
      .input('EmployeeCode', sql.NVarChar(20), employeeCode)
      .input('FullName', sql.NVarChar(120), 'Temp Policy Employee ' + RUN_ID)
      .input('JoinDate', sql.Date, '2026-01-01')
      .input('Status', sql.NVarChar(20), 'Active')
      .input('Company', sql.NVarChar(80), 'Temp Policy Company ' + RUN_ID)
      .input('Department', sql.NVarChar(100), department)
      .input('EmpGroup', sql.NVarChar(100), payGroup)
      .query('INSERT INTO dbo.Employees (EmployeeCode, FullName, JoinDate, Status, Company, Department, EmpGroup) OUTPUT INSERTED.EmployeeID VALUES (@EmployeeCode, @FullName, @JoinDate, @Status, @Company, @Department, @EmpGroup)');
    employeeId = employee.recordset[0].EmployeeID;

    const payGroupEmployee = await pool.request()
      .input('EmployeeCode', sql.NVarChar(20), payGroupEmployeeCode)
      .input('FullName', sql.NVarChar(120), 'Temp Pay Group Employee ' + RUN_ID)
      .input('JoinDate', sql.Date, '2026-01-01')
      .input('Status', sql.NVarChar(20), 'Active')
      .input('Company', sql.NVarChar(80), 'Temp Policy Company ' + RUN_ID)
      .input('Department', sql.NVarChar(100), department)
      .input('EmpGroup', sql.NVarChar(100), payGroup)
      .query('INSERT INTO dbo.Employees (EmployeeCode, FullName, JoinDate, Status, Company, Department, EmpGroup) OUTPUT INSERTED.EmployeeID VALUES (@EmployeeCode, @FullName, @JoinDate, @Status, @Company, @Department, @EmpGroup)');
    payGroupEmployeeId = payGroupEmployee.recordset[0].EmployeeID;

    const deptEmployee = await pool.request()
      .input('EmployeeCode', sql.NVarChar(20), deptEmployeeCode)
      .input('FullName', sql.NVarChar(120), 'Temp Department Employee ' + RUN_ID)
      .input('JoinDate', sql.Date, '2026-01-01')
      .input('Status', sql.NVarChar(20), 'Active')
      .input('Company', sql.NVarChar(80), 'Temp Policy Company ' + RUN_ID)
      .input('Department', sql.NVarChar(100), department)
      .input('EmpGroup', sql.NVarChar(100), 'Different' + RUN_ID.slice(-3))
      .query('INSERT INTO dbo.Employees (EmployeeCode, FullName, JoinDate, Status, Company, Department, EmpGroup) OUTPUT INSERTED.EmployeeID VALUES (@EmployeeCode, @FullName, @JoinDate, @Status, @Company, @Department, @EmpGroup)');
    deptEmployeeId = deptEmployee.recordset[0].EmployeeID;

    await pool.request()
      .input('EffectiveFrom', sql.Date, '2026-06-18')
      .input('MaxPayoutAmount', sql.Decimal(12, 2), 110)
      .input('CompanyID', sql.Int, companyId)
      .input('EmployeeID', sql.Int, null)
      .input('Department', sql.NVarChar(100), null)
      .input('EmpGroup', sql.NVarChar(100), null)
      .input('CreatedBy', sql.Int, null)
      .execute('dbo.sp_ATLAS_SaveAirfarePolicyRate');

    await pool.request()
      .input('EffectiveFrom', sql.Date, '2026-06-18')
      .input('MaxPayoutAmount', sql.Decimal(12, 2), 120)
      .input('CompanyID', sql.Int, null)
      .input('EmployeeID', sql.Int, null)
      .input('Department', sql.NVarChar(100), department)
      .input('EmpGroup', sql.NVarChar(100), null)
      .input('CreatedBy', sql.Int, null)
      .execute('dbo.sp_ATLAS_SaveAirfarePolicyRate');

    await pool.request()
      .input('EffectiveFrom', sql.Date, '2026-06-18')
      .input('MaxPayoutAmount', sql.Decimal(12, 2), 130)
      .input('CompanyID', sql.Int, null)
      .input('EmployeeID', sql.Int, null)
      .input('Department', sql.NVarChar(100), null)
      .input('EmpGroup', sql.NVarChar(100), payGroup)
      .input('CreatedBy', sql.Int, null)
      .execute('dbo.sp_ATLAS_SaveAirfarePolicyRate');

    await pool.request()
      .input('EffectiveFrom', sql.Date, '2026-06-18')
      .input('MaxPayoutAmount', sql.Decimal(12, 2), 140)
      .input('CompanyID', sql.Int, null)
      .input('EmployeeID', sql.Int, employeeId)
      .input('Department', sql.NVarChar(100), null)
      .input('EmpGroup', sql.NVarChar(100), null)
      .input('CreatedBy', sql.Int, null)
      .execute('dbo.sp_ATLAS_SaveAirfarePolicyRate');

    await pool.request()
      .input('EffectiveFrom', sql.Date, '2026-06-18')
      .input('MaxPayoutAmount', sql.Decimal(12, 2), employeePreferenceAmount)
      .input('CompanyID', sql.Int, null)
      .input('EmployeeID', sql.Int, employeeId)
      .input('Department', sql.NVarChar(100), null)
      .input('EmpGroup', sql.NVarChar(100), null)
      .input('CreatedBy', sql.Int, null)
      .execute('dbo.sp_ATLAS_SaveAirfarePolicyRate');

    await pool.request()
      .input('EffectiveFrom', sql.Date, '2026-06-22')
      .input('MaxPayoutAmount', sql.Decimal(12, 2), 135)
      .input('CompanyID', sql.Int, companyId)
      .input('EmployeeID', sql.Int, employeeId)
      .input('Department', sql.NVarChar(100), null)
      .input('EmpGroup', sql.NVarChar(100), null)
      .input('CreatedBy', sql.Int, null)
      .execute('dbo.sp_ATLAS_SaveAirfarePolicyRate');

    const employeePolicy = await pool.request()
      .input('AllocationDate', sql.Date, '2026-06-21')
      .input('CompanyID', sql.Int, companyId)
      .input('EmployeeID', sql.Int, employeeId)
      .execute('dbo.sp_ATLAS_GetEffectiveAirfarePolicy');
    assert.equal(Number(employeePolicy.recordset[0].MaxPayoutAmount), employeePreferenceAmount, 'pure employee exception should use the saved Preferences amount and win over later legacy company+employee policy');

    const sameDayRows = await pool.request()
      .input('EmployeeID', sql.Int, employeeId)
      .input('EffectiveFrom', sql.Date, '2026-06-18')
      .query('SELECT IsActive, MaxPayoutAmount FROM dbo.AirfarePolicyRates WHERE EmployeeID = @EmployeeID AND CompanyID IS NULL AND Department IS NULL AND EmpGroup IS NULL AND EffectiveFrom = @EffectiveFrom');
    assert.equal(sameDayRows.recordset.filter((row) => row.IsActive).length, 1, 'same-date employee exception save should leave one current active row');
    assert.equal(Number(sameDayRows.recordset.find((row) => row.IsActive).MaxPayoutAmount), employeePreferenceAmount, 'same-date employee exception save should keep latest Preferences amount current');

    const payGroupPolicy = await pool.request()
      .input('AllocationDate', sql.Date, '2026-06-21')
      .input('CompanyID', sql.Int, companyId)
      .input('EmployeeID', sql.Int, payGroupEmployeeId)
      .execute('dbo.sp_ATLAS_GetEffectiveAirfarePolicy');
    assert.equal(Number(payGroupPolicy.recordset[0].MaxPayoutAmount), 130, 'pay group matrix should win over department and company policy');

    const departmentPolicy = await pool.request()
      .input('AllocationDate', sql.Date, '2026-06-21')
      .input('CompanyID', sql.Int, companyId)
      .input('EmployeeID', sql.Int, deptEmployeeId)
      .execute('dbo.sp_ATLAS_GetEffectiveAirfarePolicy');
    assert.equal(Number(departmentPolicy.recordset[0].MaxPayoutAmount), 120, 'department matrix should win over company policy');

    const companyPolicy = await pool.request()
      .input('AllocationDate', sql.Date, '2026-06-21')
      .input('CompanyID', sql.Int, companyId)
      .input('EmployeeID', sql.Int, null)
      .execute('dbo.sp_ATLAS_GetEffectiveAirfarePolicy');
    assert.equal(Number(companyPolicy.recordset[0].MaxPayoutAmount), 110, 'company policy should win when no employee override is in scope');

    const review = await pool.request()
      .input('EmployeeID', sql.Int, employeeId)
      .input('AllocationDate', sql.Date, '2026-06-21')
      .input('AllocYear', sql.Int, 2026)
      .input('ExcludeAllocationID', sql.BigInt, null)
      .input('CompanyID', sql.Int, companyId)
      .execute('dbo.sp_ATLAS_GetAllocationEligibilityReview');
    assert.equal(Number(review.recordset[0].MaximumPayout), employeePreferenceAmount, 'eligibility review should use employee override amount saved in Preferences');

    const report = await pool.request()
      .input('ReportYear', sql.Int, 2026)
      .input('AsOfDate', sql.Date, '2026-06-21')
      .execute('dbo.sp_ATLAS_GetAirfareReport');
    const reportRow = report.recordset.find((row) => row.EmployeeCode === employeeCode);
    const payGroupReportRow = report.recordset.find((row) => row.EmployeeCode === payGroupEmployeeCode);
    const departmentReportRow = report.recordset.find((row) => row.EmployeeCode === deptEmployeeCode);
    assert.ok(reportRow, 'Airfare Payable report should include the temporary active employee');
    assert.equal(Number(reportRow.MaximumPayoutCap), employeePreferenceAmount, 'Airfare Payable report should use employee override amount saved in Preferences');
    assert.equal(Number(payGroupReportRow.MaximumPayoutCap), 130, 'Airfare Payable report should use pay group matrix max payout');
    assert.equal(Number(departmentReportRow.MaximumPayoutCap), 120, 'Airfare Payable report should use department matrix max payout');

    console.log(JSON.stringify({ status: 'airfare-policy-scope-passed', companyAmount: 110, departmentAmount: 120, payGroupAmount: 130, employeePreferenceAmount, reportCap: Number(reportRow.MaximumPayoutCap) }));
  } finally {
    if (employeeId) await pool.request().input('EmployeeID', sql.Int, employeeId).query('DELETE FROM dbo.AirfarePolicyRates WHERE EmployeeID = @EmployeeID; DELETE FROM dbo.Employees WHERE EmployeeID = @EmployeeID;');
    if (payGroupEmployeeId) await pool.request().input('EmployeeID', sql.Int, payGroupEmployeeId).query('DELETE FROM dbo.Employees WHERE EmployeeID = @EmployeeID;');
    if (deptEmployeeId) await pool.request().input('EmployeeID', sql.Int, deptEmployeeId).query('DELETE FROM dbo.Employees WHERE EmployeeID = @EmployeeID;');
    await pool.request()
      .input('Department', sql.NVarChar(100), department)
      .input('EmpGroup', sql.NVarChar(100), payGroup)
      .query('DELETE FROM dbo.AirfarePolicyRates WHERE Department = @Department OR EmpGroup = @EmpGroup;');
    if (companyId) await pool.request().input('CompanyID', sql.Int, companyId).query('DELETE FROM dbo.AirfarePolicyRates WHERE CompanyID = @CompanyID; DELETE FROM dbo.Companies WHERE CompanyID = @CompanyID;');
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
