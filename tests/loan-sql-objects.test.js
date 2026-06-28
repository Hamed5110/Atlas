const assert = require('assert/strict');
const sql = require('mssql');
require('dotenv').config();

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT || 1433),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
    }
  });

  const emi = await pool.request().query('SELECT dbo.fn_ATLAS_LoanEMI(120, 6) AS EMI');
  assert.equal(Number(emi.recordset[0].EMI), 20);

  const summary = await pool.request().query('EXEC dbo.sp_ATLAS_GetLoanSummary');
  assert.ok(summary.recordset.length === 1, 'Loan summary should return one row');
  assert.ok(Object.prototype.hasOwnProperty.call(summary.recordset[0], 'TotalOutstanding'));

  const register = await pool.request()
    .input('Status', sql.NVarChar(15), null)
    .query('EXEC dbo.sp_ATLAS_GetLoanRegister @Status');
  assert.ok(Array.isArray(register.recordset), 'Loan register should return rows');

  await pool.close();
  console.log('Loan SQL objects test passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
