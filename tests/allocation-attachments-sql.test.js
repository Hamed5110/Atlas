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

  const result = await pool.request().query(`
    SELECT
      OBJECT_ID('dbo.AllocationAttachments', 'U') AS AttachmentTable,
      OBJECT_ID('dbo.sp_ATLAS_AddAllocationAttachment', 'P') AS AddProc,
      OBJECT_ID('dbo.sp_ATLAS_GetAllocationAttachments', 'P') AS ListProc
  `);
  assert.ok(result.recordset[0].AttachmentTable, 'Allocation attachment table should exist');
  assert.ok(result.recordset[0].AddProc, 'Allocation attachment upload procedure should exist');
  assert.ok(result.recordset[0].ListProc, 'Allocation attachment list procedure should exist');

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const req = () => new sql.Request(transaction);
    const employee = await req()
      .input('EmployeeCode', sql.NVarChar(20), `TEST-${Date.now()}`)
      .query(`INSERT INTO Employees (EmployeeCode, FullName, Status)
              OUTPUT INSERTED.EmployeeID
              VALUES (@EmployeeCode, 'Attachment Test Employee', 'Active')`);

    const allocation = await req()
      .input('EmployeeID', sql.Int, employee.recordset[0].EmployeeID)
      .query(`INSERT INTO Allocations (EmployeeID, AllocationDate, AllocYear, TicketCost, Entitlement, CompanyPaid, ExcessAmount, PaymentMode)
              OUTPUT INSERTED.AllocationID
              VALUES (@EmployeeID, CAST(GETDATE() AS DATE), YEAR(GETDATE()), 10, 10, 10, 0, 'entitlement')`);

    const buffer = Buffer.from('%PDF-1.4 test allocation attachment');
    const uploaded = await req()
      .input('AllocationID', sql.BigInt, allocation.recordset[0].AllocationID)
      .input('FileName', sql.NVarChar(255), 'ticket-test.pdf')
      .input('MimeType', sql.NVarChar(100), 'application/pdf')
      .input('FileSize', sql.Int, buffer.length)
      .input('AttachmentData', sql.VarBinary(sql.MAX), buffer)
      .input('CreatedBy', sql.Int, null)
      .query('EXEC dbo.sp_ATLAS_AddAllocationAttachment @AllocationID, @FileName, @MimeType, @FileSize, @AttachmentData, @CreatedBy');

    assert.equal(uploaded.recordset[0].FileName, 'ticket-test.pdf');

    const listed = await req()
      .input('AllocationID', sql.BigInt, allocation.recordset[0].AllocationID)
      .query('EXEC dbo.sp_ATLAS_GetAllocationAttachments @AllocationID');
    assert.equal(listed.recordset.length, 1, 'Uploaded attachment should be listed');
  } finally {
    await transaction.rollback();
  }

  await pool.close();
  console.log('Allocation attachment SQL test passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
