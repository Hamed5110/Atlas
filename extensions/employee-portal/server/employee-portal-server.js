const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const sql = require('mssql');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const PORT = Number(process.env.EXT_EMP_PORT || 3366);
const HOST = process.env.EXT_EMP_HOST || '127.0.0.1';
const JWT_SECRET = process.env.JWT_SECRET || process.env.ATLAS_JWT_SECRET || 'atlas-extension-dev-secret';

const dbConfig = {
  server: process.env.DB_SERVER || 'localhost',
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || 'Atlasairfare010',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false'
  }
};

let poolPromise;
function getDb() {
  if (!poolPromise) poolPromise = sql.connect(dbConfig);
  return poolPromise;
}

async function applyExtensionSchema() {
  const db = await getDb();
  const script = fs.readFileSync(path.join(__dirname, '..', 'sql', 'ATLAS_Employee_Portal_Extension.sql'), 'utf8');
  const batches = script.split(/^\s*GO\s*$/gim).map((batch) => batch.trim()).filter(Boolean);
  for (const batch of batches) {
    await db.request().batch(batch);
  }
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing authorization token.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authorization token.' });
  }
}

function requirePortalRole(...roles) {
  return async (req, res, next) => {
    try {
      const db = await getDb();
      const result = await db.request()
        .input('UserID', sql.Int, req.user.UserID || req.user.userId)
        .query(`
          SELECT TOP 1 PortalRole, EmployeeID
          FROM dbo.ext_emp_auth_mapping
          WHERE UserID = @UserID AND IsActive = 1
          ORDER BY CASE WHEN PortalRole = 'Admin' THEN 0 ELSE 1 END
        `);
      const mapping = result.recordset[0];
      if (!mapping || !roles.includes(mapping.PortalRole)) return res.status(403).json({ error: 'Employee portal access denied.' });
      req.portal = mapping;
      return next();
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Portal authorization failed.' });
    }
  };
}

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'ui')));

app.get('/api/ext/employee-portal/health', async (_req, res) => {
  try {
    await getDb();
    res.json({ status: 'healthy', extension: 'employee-portal', port: PORT });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

app.post('/api/ext/employee-portal/bootstrap-schema', authenticate, async (req, res) => {
  if ((req.user.Role || req.user.role) !== 'admin') return res.status(403).json({ error: 'Admin role required.' });
  await applyExtensionSchema();
  res.json({ status: 'ok', schema: 'employee-portal-extension' });
});

app.get('/api/ext/employee-portal/me', authenticate, requirePortalRole('Employee', 'Admin'), async (req, res) => {
  const db = await getDb();
  const result = await db.request()
    .input('EmployeeID', sql.Int, req.portal.EmployeeID)
    .query(`
      SELECT EmployeeID, EmployeeCode, FullName, Department, Designation, Email, JoinDate, OpeningBHD, MaximumPayout
      FROM dbo.Employees
      WHERE EmployeeID = @EmployeeID
    `);
  res.json({ user: req.user, portal: req.portal, employee: result.recordset[0] || null });
});

app.get('/api/ext/employee-portal/tickets', authenticate, requirePortalRole('Employee', 'Admin'), async (req, res) => {
  const db = await getDb();
  const request = db.request()
    .input('UserID', sql.Int, req.user.UserID || req.user.userId)
    .input('EmployeeID', sql.Int, req.portal.EmployeeID);
  const result = await request.query(`
    SELECT r.RequestID, r.RequestNo, r.EmployeeID, e.EmployeeCode, e.FullName, r.TravelFromDate, r.TravelToDate,
           r.Origin, r.Destination, r.TripType, r.CabinClass, r.EstimatedCostBHD, r.PreferredAirline,
           r.Purpose, r.ApprovalStatus, r.SubmittedAt, r.CreatedAt, r.UpdatedAt
    FROM dbo.ext_emp_ticket_requests r
    INNER JOIN dbo.Employees e ON e.EmployeeID = r.EmployeeID
    WHERE (@EmployeeID = r.EmployeeID OR EXISTS (
        SELECT 1 FROM dbo.ext_emp_auth_mapping m WHERE m.UserID = @UserID AND m.IsActive = 1 AND m.PortalRole = 'Admin'
    ))
    ORDER BY r.CreatedAt DESC, r.RequestID DESC
  `);
  res.json(result.recordset);
});

app.post('/api/ext/employee-portal/tickets', authenticate, requirePortalRole('Employee', 'Admin'), async (req, res) => {
  const db = await getDb();
  const body = req.body || {};
  const result = await db.request()
    .input('ActorUserID', sql.Int, req.user.UserID || req.user.userId)
    .input('EmployeeID', sql.Int, body.employeeId || null)
    .input('TravelFromDate', sql.Date, body.travelFromDate)
    .input('TravelToDate', sql.Date, body.travelToDate || null)
    .input('Origin', sql.NVarChar(80), body.origin || null)
    .input('Destination', sql.NVarChar(120), body.destination)
    .input('TripType', sql.NVarChar(20), body.tripType || 'RoundTrip')
    .input('CabinClass', sql.NVarChar(20), body.cabinClass || 'Economy')
    .input('EstimatedCostBHD', sql.Decimal(12, 2), Number(body.estimatedCostBHD || 0))
    .input('PreferredAirline', sql.NVarChar(80), body.preferredAirline || null)
    .input('Purpose', sql.NVarChar(250), body.purpose || null)
    .execute('dbo.sp_ext_emp_create_ticket_request');
  res.status(201).json(result.recordset[0]);
});

app.post('/api/ext/employee-portal/tickets/:id/transition', authenticate, requirePortalRole('Employee', 'Admin'), async (req, res) => {
  const db = await getDb();
  const result = await db.request()
    .input('ActorUserID', sql.Int, req.user.UserID || req.user.userId)
    .input('RequestID', sql.BigInt, Number(req.params.id))
    .input('ToStatus', sql.NVarChar(30), req.body.toStatus)
    .input('ActionNote', sql.NVarChar(500), req.body.actionNote || null)
    .execute('dbo.sp_ext_emp_transition_ticket_request');
  res.json(result.recordset[0]);
});

app.listen(PORT, HOST, async () => {
  await applyExtensionSchema();
  console.log(`ATLAS employee portal extension running on http://${HOST}:${PORT}`);
});
