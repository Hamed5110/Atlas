// =====================================================
// ATLAS Airfare & Loan Manager - Backend API Server
// Node.js + Express + MSSQL
// =====================================================

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const Joi = require('joi');

const app = express();
const PORT = Number(process.env.PORT || 3355);
const HOST = process.env.ATLAS_BIND_HOST || process.env.HOST || '0.0.0.0';
const FRONTEND_BUILD_DIR = path.join(__dirname, "atlas-hcm-next", "out");
const FRONTEND_STATIC_OPTIONS = {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
};
const MAX_COMPANY_PAYABLE = 150;
const EMPLOYEE_GROUP_MAX_LENGTH = 80;
const AIRFARE_STANDARD_YEAR_DAYS = 360;
const AIRFARE_ENTITLEMENT_CYCLE_DAYS = 720;
const AIRFARE_CYCLE_DAYS = 60;
const AIRFARE_WORKING_DAYS_PER_AIRFARE_DAY = 30;
const ALLOCATION_PAYMENT_MODES = Object.freeze(["entitlement", "company", "company_full", "employee", "employee_full", "loan"]);

fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });

// =====================================================
// WINSTON LOGGER
// =====================================================
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});

function parseAllocationYear(raw, dateValue = null) {
    const currentYear = new Date().getFullYear();
    const parsedDateYear = new Date(dateValue);
    const provided = Number(raw);

    if (Number.isInteger(provided)) return provided;
    if (dateValue && Number.isInteger(parsedDateYear.getFullYear()) && !isNaN(parsedDateYear.getTime())) {
        return parsedDateYear.getFullYear();
    }
    return currentYear;
}

function roundMoney(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

function toIntegerArray(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0)
  ));
}

function buildInClause(dbRequest, values, parameterPrefix) {
  const normalized = values.slice(0);
  const params = normalized.map((value, index) => {
    const key = `${parameterPrefix}_${index}`;
    dbRequest.input(key, sql.Int, value);
    return `@${key}`;
  });
  return {
    clause: normalized.length ? params.join(",") : "",
    values: normalized
  };
}

function currentAirfareDaysFromWorkingDays(workingDays = 0) {
    const cappedWorkingDays = Math.max(0, Math.min(AIRFARE_STANDARD_YEAR_DAYS, Number(workingDays) || 0));
    return roundMoney((cappedWorkingDays / AIRFARE_WORKING_DAYS_PER_AIRFARE_DAY) * 2.5, 4);
}

function calculateAllocationWorkingDays(targetDate, allocYear, joinDateValue = null, previousAllocationDateValue = null) {
    const date = targetDate ? new Date(targetDate) : new Date();
    if (Number.isNaN(date.getTime())) return 0;
    const year = Number(allocYear) || date.getFullYear();
    if (date.getFullYear() !== year) {
        return date.getFullYear() < year ? 0 : 360;
    }
    const yearStart = new Date(year, 0, 1);
    const joinDate = joinDateValue ? new Date(joinDateValue) : null;
    const previousAllocationDate = previousAllocationDateValue ? new Date(previousAllocationDateValue) : null;
    const resetDate = previousAllocationDate && !Number.isNaN(previousAllocationDate.getTime())
        ? new Date(previousAllocationDate.getFullYear(), previousAllocationDate.getMonth(), previousAllocationDate.getDate() + 1)
        : null;
    const startDate = [yearStart, joinDate, resetDate]
        .filter((item) => item && !Number.isNaN(item.getTime()))
        .reduce((latest, item) => item > latest ? item : latest, yearStart);
    if (startDate > date) return 0;
    const endSerial = date.getMonth() * 30 + date.getDate();
    const startSerial = startDate.getMonth() * 30 + startDate.getDate();
    const elapsed = endSerial - startSerial + 1;
    return Math.max(0, Math.min(360, elapsed));
}

function calculateEmployeeEntitlement(employee, openingDays, targetDate, allocYear, maximumPayout) {
    const maxPayout = Math.min(MAX_COMPANY_PAYABLE, Math.max(0, Number(maximumPayout) || MAX_COMPANY_PAYABLE));
    const opening = Number.isFinite(Number(openingDays)) ? Number(openingDays) : Number(employee.OpeningDays || 0);
    const paidDays = Number(employee.AirfarePaidDays || 0);
    const workingDays = calculateAllocationWorkingDays(targetDate, Number(allocYear) || new Date().getFullYear());
    const currentAirfareDays = currentAirfareDaysFromWorkingDays(workingDays);
    const remainingDays = roundMoney(Math.min(AIRFARE_CYCLE_DAYS, Math.max(0, opening + currentAirfareDays - paidDays)), 4);
    const entitlement = roundMoney((maxPayout / AIRFARE_CYCLE_DAYS) * remainingDays, 2);
    return {
        maximumPayout: maxPayout,
        openingDays: opening,
        paidDays,
        workingDays,
        currentAirfareDays,
        remainingDays,
        entitlement: Math.min(maxPayout, entitlement)
    };
}

function calculatePolicyEntitlement(maximumPayout, targetDate, allocYear, currentYearSpending = 0, context = {}) {
    const maxPayout = Math.min(MAX_COMPANY_PAYABLE, Math.max(0, Number(maximumPayout) || MAX_COMPANY_PAYABLE));
    const openingAmount = Math.max(0, Number(context.openingAmount || 0));
    const extraPaidDays = Math.max(0, Number(context.paidDays || 0));
    const workingDays = calculateAllocationWorkingDays(
        targetDate,
        Number(allocYear) || new Date().getFullYear(),
        context.joinDate || null,
        context.previousAllocationDate || null
    );
    const currentAirfareDays = currentAirfareDaysFromWorkingDays(workingDays);
    const perDayRate = maxPayout > 0 ? (maxPayout / AIRFARE_CYCLE_DAYS) : 0;
    const paidAmount = Math.max(0, Number(currentYearSpending) || 0) + (extraPaidDays * perDayRate);
    const currentYearEarnedAmount = perDayRate * currentAirfareDays;
    const totalEntitlement = Math.min(maxPayout, Math.max(0, openingAmount + currentYearEarnedAmount));
    return roundMoney(Math.max(0, totalEntitlement - paidAmount));
}

function clampAirfareMaximumPayout(value) {
    return Math.min(MAX_COMPANY_PAYABLE, Math.max(0, Number(value) || MAX_COMPANY_PAYABLE));
}

function clampAirfareDays(value) {
    return Math.min(AIRFARE_CYCLE_DAYS, Math.max(0, Number(value) || 0));
}

async function getYearAllocationContext(db, employeeId, allocYear, excludeAllocationId = null, allocationDate = null) {
    const request = db.request()
        .input('EmployeeID', sql.Int, employeeId)
        .input('AllocYear', sql.Int, allocYear)
        .input('AllocationDate', sql.Date, allocationDate || null);

    if (excludeAllocationId !== null) {
        request.input('ExcludeAllocationID', sql.BigInt, excludeAllocationId);
    }

    const result = await request.execute('sp_ATLAS_GetAllocationContext');
    const contextRow = result.recordset?.[0] || {};
    const firstAllocation = result.recordset?.[1]?.[0] || null;

    return {
        totalTickets: Number(contextRow.TotalTickets) || 0,
        currentYearSpending: Number(contextRow.CurrentYearSpending) || 0,
        firstAllocation,
        previousAllocation: result.recordset?.[2]?.[0] || null
    };
}

async function ensureEmployeeEligibilitySql(db) {
    await db.request().batch(`
DECLARE @employeeStatusConstraint SYSNAME;
SELECT TOP (1) @employeeStatusConstraint = cc.name
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID(N'dbo.Employees')
  AND cc.definition LIKE N'%Status%'
  AND cc.definition LIKE N'%Active%'
  AND cc.definition NOT LIKE N'%Probation%';

IF @employeeStatusConstraint IS NOT NULL
BEGIN
    DECLARE @dropEmployeeStatusConstraintSql NVARCHAR(MAX) = N'ALTER TABLE dbo.Employees DROP CONSTRAINT ' + QUOTENAME(@employeeStatusConstraint);
    EXEC sp_executesql @dropEmployeeStatusConstraintSql;
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id = OBJECT_ID(N'dbo.Employees')
      AND cc.definition LIKE N'%Status%'
      AND cc.definition LIKE N'%Probation%'
)
BEGIN
    ALTER TABLE dbo.Employees WITH CHECK ADD CONSTRAINT CK_ATLAS_Employees_Status
    CHECK (Status IN ('Active', 'Inactive', 'In-active', 'Resign', 'Resigned', 'Separated', 'Probation'));
END;

IF COL_LENGTH('dbo.Employees', 'WhatsAppNumber') IS NULL
BEGIN
    ALTER TABLE dbo.Employees ADD WhatsAppNumber NVARCHAR(30) NULL;
END;
`);

    await db.request().batch(`
CREATE OR ALTER FUNCTION dbo.fn_ATLAS_IsAirfareEligibleEmployeeStatus
(
    @Status NVARCHAR(50)
)
RETURNS BIT
AS
BEGIN
    DECLARE @normalized NVARCHAR(50) = LOWER(REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(@Status, N'Active'))), N'-', N''), N' ', N''));
    RETURN CASE
        WHEN @normalized IN (N'', N'active') THEN 1
        WHEN @normalized IN (N'inactive', N'inactiveemployee', N'resign', N'resigned', N'separated', N'probation') THEN 0
        ELSE 0
    END;
END;
`);

    await db.request().batch(`
CREATE OR ALTER FUNCTION dbo.fn_ATLAS_EmployeesByAirfareStatus
(
    @StatusScope NVARCHAR(20)
)
RETURNS TABLE
AS
RETURN
(
    SELECT *
    FROM dbo.vw_ATLAS_EmployeeMaster e
    WHERE
        LOWER(ISNULL(@StatusScope, N'active')) = N'all'
        OR (LOWER(ISNULL(@StatusScope, N'active')) IN (N'active', N'eligible') AND dbo.fn_ATLAS_IsAirfareEligibleEmployeeStatus(e.Status) = 1)
        OR (LOWER(ISNULL(@StatusScope, N'active')) IN (N'inactive', N'ineligible') AND dbo.fn_ATLAS_IsAirfareEligibleEmployeeStatus(e.Status) = 0)
);
`);

    await db.request().batch(`
CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetAirfareEligibleEmployees
AS
BEGIN
    SET NOCOUNT ON;

    SELECT *
    FROM dbo.fn_ATLAS_EmployeesByAirfareStatus(N'active')
    ORDER BY EmployeeCode;
END;
`);

    await db.request().batch(`
CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetEmployeeMasterForScreen
    @StatusScope NVARCHAR(20) = N'active'
AS
BEGIN
    SET NOCOUNT ON;

    SELECT *
    FROM dbo.fn_ATLAS_EmployeesByAirfareStatus(@StatusScope)
    ORDER BY EmployeeCode;
END;
`);
}

async function getEffectiveAirfarePolicy(db, allocationDate, companyId = null, employeeId = null) {
    await ensureAtlasSqlObjects(db);
    const result = await withSqlRetry(() => db.request()
        .input('AllocationDate', sql.Date, allocationDate || new Date())
        .input('CompanyID', sql.Int, companyId)
        .input('EmployeeID', sql.Int, employeeId)
        .execute('sp_ATLAS_GetEffectiveAirfarePolicy'), 'get effective airfare policy');
    const row = result.recordset?.[0] || {};
    const maxPayout = clampAirfareMaximumPayout(row.MaxPayoutAmount);
    const cycleDays = Number(row.CycleDays) || 60;
    return {
        policyRateId: row.PolicyRateID ? Number(row.PolicyRateID) : null,
        companyId: row.CompanyID ? Number(row.CompanyID) : null,
        employeeId: row.EmployeeID ? Number(row.EmployeeID) : null,
        effectiveFrom: row.EffectiveFrom || allocationDate || new Date(),
        maxPayoutAmount: maxPayout,
        cycleDays,
        perDayRate: Number(row.PerDayRate) || (maxPayout / cycleDays)
    };
}

async function getPolicyEntitlementFromDb(db, { maximumPayout, allocationDate, allocYear, openingDays, openingBhd, paidDays, currentYearSpending, joinDate, previousAllocationDate }) {
    const result = await db.request()
        .input('MaximumPayout', sql.Decimal(10, 2), maximumPayout)
        .input('AllocationDate', sql.Date, allocationDate)
        .input('AllocYear', sql.Int, allocYear)
        .input('OpeningDays', sql.Decimal(10, 4), openingDays)
        .input('OpeningBHD', sql.Decimal(10, 2), openingBhd)
        .input('PaidDays', sql.Decimal(10, 4), paidDays)
        .input('CurrentYearSpending', sql.Decimal(10, 2), currentYearSpending)
        .input('JoinDate', sql.Date, joinDate || null)
        .input('PreviousAllocationDate', sql.Date, previousAllocationDate || null)
        .output('PolicyEntitlement', sql.Decimal(10, 2))
        .output('CurrentAirfareDays', sql.Decimal(10, 4))
        .output('RemainingDays', sql.Decimal(10, 4))
        .output('CurrentYearRemaining', sql.Decimal(10, 2))
        .execute('sp_ATLAS_CalcPolicyEntitlement');

    return {
        policyEntitlement: Math.min(clampAirfareMaximumPayout(maximumPayout), Number(result.output.PolicyEntitlement) || 0),
        currentAirfareDays: Number(result.output.CurrentAirfareDays) || 0,
        remainingDays: Number(result.output.RemainingDays) || 0,
        currentYearRemaining: Number(result.output.CurrentYearRemaining) || 0
    };
}

async function normalizeAllocationAmountsDb(db, {
    ticketCost,
    policyEntitlement,
    maximumPayout,
    paymentMode,
    employeePaid,
    loanAmount,
    companyExtra
}) {
    const result = await db.request()
        .input('TicketCost', sql.Decimal(10, 2), ticketCost)
        .input('PolicyEntitlement', sql.Decimal(10, 2), policyEntitlement)
        .input('MaximumPayout', sql.Decimal(10, 2), maximumPayout)
        .input('PaymentMode', sql.NVarChar(20), paymentMode)
        .input('EmployeePaid', sql.Decimal(10, 2), employeePaid)
        .input('LoanAmount', sql.Decimal(10, 2), loanAmount)
        .input('CompanyExtra', sql.Decimal(10, 2), companyExtra)
        .output('CompanyPaid', sql.Decimal(10, 2))
        .output('EmployeePaidOut', sql.Decimal(10, 2))
        .output('LoanAmountOut', sql.Decimal(10, 2))
        .output('CompanyExtraOut', sql.Decimal(10, 2))
        .output('ExcessOut', sql.Decimal(10, 2))
        .output('EntitlementOut', sql.Decimal(10, 2))
        .output('CompanyBalancePayAmount', sql.Decimal(10, 2))
        .execute('sp_ATLAS_NormalizeAllocationAmounts');

    return {
        ticketCost: Number(ticketCost) || 0,
        companyPaid: Number(result.output.CompanyPaid) || 0,
        excess: Number(result.output.ExcessOut) || 0,
        employeePaid: Number(result.output.EmployeePaidOut) || 0,
        loanAmount: Number(result.output.LoanAmountOut) || 0,
        companyExtra: Number(result.output.CompanyExtraOut) || 0,
        companyBalancePayAmount: Number(result.output.CompanyBalancePayAmount) || 0,
        entitlement: Number(result.output.EntitlementOut) || 0,
        maxPayoutApplied: Number(maximumPayout) || 0
    };
}

async function getAllocationEmployeeContext(db, employeeId, allocYear) {
    const result = await db.request()
        .input('EmployeeID', sql.Int, employeeId)
        .input('AllocYear', sql.Int, allocYear)
        .query(`
            SELECT
                e.EmployeeID,
                e.EmployeeCode,
                e.FullName,
                e.MaximumPayout,
                e.OpeningDays,
                e.AirfarePaidDays,
                e.Status,
                ob.OpeningDays AS BalanceOpeningDays
            FROM Employees e
            LEFT JOIN OpeningBalances ob
                ON ob.EmployeeID = e.EmployeeID
               AND ob.BalanceYear = @AllocYear
            WHERE e.EmployeeID = @EmployeeID
        `);
    return result.recordset[0] || null;
}

function sendUiUnavailable(req, res, reason = "Frontend service is temporarily unavailable.") {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.status(405).json({ error: 'Frontend service is temporarily unavailable.' });
        return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(503).send(`
        <!doctype html>
        <html>
          <head><title>ATLAS UI unavailable</title></head>
          <body style="font-family:Arial,sans-serif;padding:24px">
            <h2>ATLAS UI is temporarily unavailable</h2>
            <p>${reason}</p>
            <p>Please verify the frontend build exists under atlas-hcm-next/out.</p>
          </body>
        </html>
    `);
}

function isFrontendRequest(req) {
    const targetPath = req.path || '';
    return !targetPath.startsWith('/api/') && targetPath !== '/health';
}

function hasFileExtension(pathname) {
    return /\.[a-zA-Z0-9]+$/.test(pathname || '');
}

function serveFrontendIndex(req, res) {
    const indexPath = path.join(FRONTEND_BUILD_DIR, 'index.html');
    if (!fs.existsSync(indexPath)) {
        return sendUiUnavailable(req, res, "Frontend build is missing. Run atlas-hcm-next build step first.");
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(indexPath);
}

// =====================================================
// MSSQL DATABASE CONFIG
// =====================================================
const dbConfig = {
    server: process.env.DB_SERVER || 'localhost\\ATLAS',
    port: parseInt(process.env.DB_PORT) || 1433,
    database: process.env.DB_NAME || 'Atlasairfare010',
    user: process.env.DB_USER || 'atlas_user',
    password: process.env.DB_PASSWORD || '',
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
    },
    pool: {
        max: 20,
        min: 5,
        idleTimeoutMillis: 30000
    }
};

// Global connection pool
let pool = null;

async function getConnection() {
    if (!pool) {
        pool = await new sql.ConnectionPool(dbConfig).connect();
        logger.info('MSSQL Connection Pool established');
    }
    return pool;
}

async function getAdminConnection(database = 'master') {
    return new sql.ConnectionPool({
        ...dbConfig,
        database,
        pool: {
            max: 3,
            min: 0,
            idleTimeoutMillis: 15000
        }
    }).connect();
}

async function closeSharedConnection() {
    if (!pool) return;
    try {
        await pool.close();
    } catch (err) {
        logger.warn('MSSQL shared pool close warning:', err.message);
    } finally {
        pool = null;
        sqlObjectsReady = false;
        sqlObjectsPromise = null;
    }
}

let sqlObjectsReady = false;
let sqlObjectsPromise = null;

function isSqlRetryableError(err) {
    return [1205, 2021].includes(Number(err?.number)) ||
        /deadlocked|modified during DDL execution|Please retry/i.test(String(err?.message || ''));
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSqlRetry(operation, label, attempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await operation();
        } catch (err) {
            lastError = err;
            if (!isSqlRetryableError(err) || attempt === attempts) break;
            logger.warn(`${label} retry ${attempt}/${attempts - 1}: ${err.message}`);
            await sleep(180 * attempt);
        }
    }
    throw lastError;
}

async function ensureAtlasSqlObjects(db) {
    if (sqlObjectsReady) return;
    if (!sqlObjectsPromise) {
        sqlObjectsPromise = (async () => {
            await ensureEmployeeEligibilitySql(db);
            await ensureAirfarePolicySql(db);
            await ensureAllocationPaymentSql(db);
            await ensureLoanOperationSql(db);
            await ensureYearEndOperationSql(db);
            await cleanupQaTemporaryCompanies(db);
            sqlObjectsReady = true;
        })().catch((err) => {
            sqlObjectsPromise = null;
            sqlObjectsReady = false;
            throw err;
        });
    }
    await sqlObjectsPromise;
}

async function cleanupQaTemporaryCompanies(db) {
    try {
        const result = await db.request().query(`
            SELECT c.CompanyID, c.CompanyCode, c.CompanyName, c.DatabaseName
            FROM dbo.Companies c
            WHERE (
                    c.CompanyCode LIKE 'QAC%'
                    OR c.CompanyName LIKE 'QA Temporary Company%'
                    OR c.DatabaseName LIKE 'ATLAS_QA_%'
                )
              AND NOT EXISTS (
                    SELECT 1
                    FROM dbo.Employees e
                    WHERE UPPER(LTRIM(RTRIM(ISNULL(e.Company, '')))) IN (
                        UPPER(LTRIM(RTRIM(ISNULL(c.CompanyCode, '')))),
                        UPPER(LTRIM(RTRIM(ISNULL(c.CompanyName, '')))),
                        UPPER(LTRIM(RTRIM(ISNULL(c.DatabaseName, ''))))
                    )
                )
              AND NOT EXISTS (
                    SELECT 1
                    FROM dbo.AirfarePolicyRates r
                    WHERE r.CompanyID = c.CompanyID
                );
        `);

        for (const company of result.recordset || []) {
            const databaseName = String(company.DatabaseName || '').trim();
            if (databaseName && /^ATLAS_QA_[A-Za-z0-9_]*$/i.test(databaseName)) {
                await db.request().query(`
                    IF DB_ID(${sqlLiteral(databaseName)}) IS NOT NULL
                    BEGIN
                        ALTER DATABASE ${sqlIdentifier(databaseName)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                        DROP DATABASE ${sqlIdentifier(databaseName)};
                    END;
                `);
            }
            await db.request()
                .input('CompanyID', sql.Int, company.CompanyID)
                .query('DELETE FROM dbo.Companies WHERE CompanyID = @CompanyID');
            logger.info(`Cleaned QA temporary company ${company.CompanyName || company.CompanyCode}`);
        }
    } catch (err) {
        logger.warn(`QA temporary company cleanup skipped: ${err.message}`);
    }
}

function diagnosticStatus(success, latencyMs, degradedMs) {
    if (!success) return 'DOWN';
    return Number(latencyMs) > degradedMs ? 'DEGRADED' : 'UP';
}

function parseExternalHealthUrls() {
    return String(process.env.EXTERNAL_HEALTH_URLS || '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean)
        .slice(0, 12);
}

async function fetchWithTimeout(url, timeoutMs = 5000) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        const latencyMs = Date.now() - started;
        return {
            name: url,
            url,
            success: response.ok,
            httpStatus: response.status,
            latencyMs,
            status: diagnosticStatus(response.ok, latencyMs, 800),
            checkedAt: new Date().toISOString()
        };
    } catch (err) {
        return {
            name: url,
            url,
            success: false,
            latencyMs: Date.now() - started,
            status: 'DOWN',
            error: err.name === 'AbortError' ? 'Timeout after 5000ms' : err.message,
            checkedAt: new Date().toISOString()
        };
    } finally {
        clearTimeout(timer);
    }
}

function summarizeDiagnostics(checks) {
    const statuses = checks.map((check) => check.status);
    if (statuses.includes('DOWN')) return 'DOWN';
    if (statuses.includes('DEGRADED')) return 'DEGRADED';
    if (statuses.includes('UP')) return 'UP';
    return 'IDLE';
}

async function runSystemDiagnostics() {
    const started = Date.now();
    const checks = await Promise.allSettled([
        (async () => {
            const dbStarted = Date.now();
            const db = await getConnection();
            await db.request().query('SELECT 1 AS HealthCheck');
            const latencyMs = Date.now() - dbStarted;
            return {
                key: 'database',
                name: 'MSSQL database',
                type: 'database',
                success: true,
                latencyMs,
                thresholdMs: 300,
                status: diagnosticStatus(true, latencyMs, 300),
                detail: `Connected to ${dbConfig.database}`
            };
        })(),
        (async () => {
            const buildStarted = Date.now();
            const indexPath = path.join(FRONTEND_BUILD_DIR, 'index.html');
            const success = fs.existsSync(indexPath);
            const latencyMs = Date.now() - buildStarted;
            return {
                key: 'frontend-build',
                name: 'Frontend build',
                type: 'application',
                success,
                latencyMs,
                thresholdMs: 300,
                status: success ? diagnosticStatus(true, latencyMs, 300) : 'DOWN',
                detail: success ? 'Static frontend build is available.' : 'Frontend build is missing.'
            };
        })(),
        (async () => {
            const servicesStarted = Date.now();
            const urls = parseExternalHealthUrls();
            if (urls.length === 0) {
                return {
                    key: 'external-apis',
                    name: 'External APIs',
                    type: 'integration',
                    success: true,
                    latencyMs: Date.now() - servicesStarted,
                    thresholdMs: 800,
                    status: 'IDLE',
                    detail: 'No external API health URLs configured.',
                    services: []
                };
            }
            const settled = await Promise.allSettled(urls.map((url) => fetchWithTimeout(url, 5000)));
            const services = settled.map((result, index) => result.status === 'fulfilled' ? result.value : {
                name: urls[index],
                url: urls[index],
                success: false,
                latencyMs: 5000,
                status: 'DOWN',
                error: result.reason?.message || 'External API check failed',
                checkedAt: new Date().toISOString()
            });
            const status = summarizeDiagnostics(services);
            return {
                key: 'external-apis',
                name: 'External APIs',
                type: 'integration',
                success: status !== 'DOWN',
                latencyMs: Date.now() - servicesStarted,
                thresholdMs: 800,
                status,
                detail: `${services.length} external service check(s) completed.`,
                services
            };
        })()
    ]);

    const normalizedChecks = checks.map((result, index) => {
        if (result.status === 'fulfilled') return result.value;
        const names = ['MSSQL database', 'Frontend build', 'External APIs'];
        return {
            key: `diagnostic-${index + 1}`,
            name: names[index] || `Diagnostic ${index + 1}`,
            type: 'system',
            success: false,
            latencyMs: Date.now() - started,
            thresholdMs: index === 0 ? 300 : 800,
            status: 'DOWN',
            detail: result.reason?.message || 'Diagnostic failed.'
        };
    });

    return {
        status: summarizeDiagnostics(normalizedChecks),
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        checks: normalizedChecks
    };
}

function statusRank(status) {
    const normalized = String(status || '').toUpperCase();
    if (normalized === 'FAIL' || normalized === 'DOWN' || normalized === 'CRITICAL') return 3;
    if (normalized === 'WARN' || normalized === 'DEGRADED' || normalized === 'WARNING') return 2;
    if (normalized === 'PASS' || normalized === 'UP' || normalized === 'INFO') return 1;
    return 0;
}

function modelStatusFromRanks(ranks) {
    const highest = Math.max(0, ...ranks);
    if (highest >= 3) return 'Action required';
    if (highest >= 2) return 'Review recommended';
    return 'Verified';
}

function summarizeCheckGroup(checks, codes, fallbackTitle, targetView) {
    const selected = checks.filter((check) => codes.includes(check.CheckCode));
    const ranks = selected.map((check) => statusRank(check.Status));
    return {
        title: fallbackTitle,
        status: modelStatusFromRanks(ranks),
        targetView,
        checks: selected.length,
        evidenceCount: selected.reduce((sum, check) => sum + Number(check.EvidenceCount || 0), 0),
        codes
    };
}

function buildAutomaticVerificationModel({ controlCenter, verification, diagnostics, currentYear, asOfDate }) {
    const checks = verification.checks || [];
    const failedChecks = checks.filter((check) => String(check.Status).toUpperCase() === 'FAIL');
    const warningChecks = checks.filter((check) => String(check.Status).toUpperCase() === 'WARN');
    const diagnosticIssues = (diagnostics.checks || []).filter((check) => ['DOWN', 'DEGRADED'].includes(String(check.status).toUpperCase()));
    const controlRisks = controlCenter.risks || [];
    const riskRanks = controlRisks.map((risk) => statusRank(risk.Severity));
    const ranks = [
        ...checks.map((check) => statusRank(check.Status)),
        ...diagnosticIssues.map((check) => statusRank(check.status)),
        ...riskRanks
    ];
    const verificationScore = Number(verification.summary?.VerificationScore ?? controlCenter.summary?.IntelligenceScore ?? 100);
    const diagnosticPenalty = diagnostics.status === 'DOWN' ? 20 : diagnostics.status === 'DEGRADED' ? 8 : 0;
    const riskPenalty = controlRisks.filter((risk) => statusRank(risk.Severity) >= 3).length * 5;
    const integrityScore = Math.max(0, Math.min(100, verificationScore - diagnosticPenalty - riskPenalty));
    const automationPlan = [
        summarizeCheckGroup(checks, ['ALLOCATION_AMOUNT_RECONCILIATION', 'POLICY_SNAPSHOT_LOCKED', 'OPENING_AMOUNT_SYSTEM_CALC', 'AIRFARE_PAYABLE_CURRENT_YEAR_RULE'], 'Formula and policy snapshot integrity', 'Airfare'),
        summarizeCheckGroup(checks, ['DUPLICATE_TICKET_APPROVAL', 'IMPORT_PREVIEW_GATES'], 'Approval and import control integrity', 'Airfare'),
        summarizeCheckGroup(checks, ['OPEN_LOAN_REVIEW'], 'Loan register integrity', 'Loans'),
        summarizeCheckGroup(checks, ['YEAR_END_NEGATIVE_BALANCE'], 'Year-end readiness integrity', 'Year End'),
        summarizeCheckGroup(checks, ['COMPANY_LOGO_PRINT_READY', 'RECENT_DATABASE_BACKUP', 'ACTIVE_ADMIN_EXISTS'], 'Company, backup, and security integrity', 'Companies'),
        summarizeCheckGroup(checks, ['REPORT_DRILLDOWN_REFERENTIAL_LINKS', 'REPORT_SUBTOTAL_GRAND_TOTAL_SOURCE', 'REPORT_NUMERIC_DAYS_AMOUNT_LAYOUT', 'REPORT_SCREEN_READABILITY_LAYOUT'], 'Report and view display integrity', 'Reports')
    ];
    const actionQueue = [
        ...failedChecks,
        ...warningChecks
    ].map((check) => ({
        priority: String(check.Status).toUpperCase() === 'FAIL' ? 'High' : 'Medium',
        source: 'SQL verification',
        title: check.Title,
        detail: check.Detail,
        targetView: check.TargetView || null,
        targetRecordType: check.TargetRecordType || null,
        targetRecordID: check.TargetRecordID || null
    })).concat(diagnosticIssues.map((check) => ({
        priority: String(check.status).toUpperCase() === 'DOWN' ? 'High' : 'Medium',
        source: 'System diagnostics',
        title: check.name,
        detail: check.detail || `${check.name} returned ${check.status}`,
        targetView: 'AI Insights',
        targetRecordType: null,
        targetRecordID: null
    })));

    return {
        modelName: 'ATLAS Automatic Verification Model',
        mode: 'read-only observer',
        rulesLocked: true,
        formulaPolicy: 'No business formulas, year-end rules, loan rules, report formulas, or company rules are changed by this model.',
        generatedAt: new Date().toISOString(),
        asOfDate: asOfDate || null,
        currentYear: Number.isInteger(currentYear) ? currentYear : (verification.summary?.CurrentYear || new Date().getFullYear()),
        integrityStatus: modelStatusFromRanks(ranks),
        integrityScore,
        controlSignals: {
            intelligenceStatus: controlCenter.summary?.OverallStatus || 'Loaded',
            verificationStatus: verification.summary?.VerificationStatus || 'Loaded',
            diagnosticsStatus: diagnostics.status,
            failedChecks: failedChecks.length,
            warningChecks: warningChecks.length,
            riskItems: controlRisks.length,
            diagnosticIssues: diagnosticIssues.length
        },
        automationPlan,
        actionQueue,
        evidence: {
            verificationSummary: verification.summary || {},
            diagnosticSummary: {
                status: diagnostics.status,
                checkedAt: diagnostics.checkedAt,
                latencyMs: diagnostics.latencyMs,
                checks: (diagnostics.checks || []).map((check) => ({
                    key: check.key,
                    name: check.name,
                    status: check.status,
                    detail: check.detail
                }))
            },
            intelligenceSummary: controlCenter.summary || {}
        }
    };
}

function normalizeAllocationAmounts(alloc, maximumPayout, policyContext = {}) {
    const maxPayout = Math.max(0, Number(maximumPayout) || 150);
    const companyMaxPayable = Math.min(maxPayout, MAX_COMPANY_PAYABLE);
    const paymentMode = String(alloc.paymentMode || "entitlement").toLowerCase();
    const ticketCost = Math.max(0, Number(alloc.ticketCost) || 0);
    const inputEntitlement = Math.max(0, Number(alloc.entitlement) || 0);
    const hasPolicyEntitlement = Object.prototype.hasOwnProperty.call(policyContext, "entitlement");
    const policyEntitlement = hasPolicyEntitlement ? Math.max(0, Number(policyContext.entitlement || 0)) : 0;
    const resolvedEntitlement = hasPolicyEntitlement ? policyEntitlement : Math.max(0, inputEntitlement);
    const inputEmployeePaid = Math.max(0, Number(alloc.employeePaid) || 0);
    const inputLoanAmount = Math.max(0, Number(alloc.loanAmount) || 0);
    const inputCompanyExtra = Math.max(0, Number(alloc.companyExtra) || 0);

    const entitlement = resolvedEntitlement;
    const companyBasePaid = Math.min(ticketCost, entitlement, companyMaxPayable);
    const excessBalance = Math.max(0, ticketCost - companyBasePaid);
    const companyExtraCapacity = Math.max(0, companyMaxPayable - companyBasePaid);
    const requestedCompanyExtra = inputCompanyExtra > 0 ? inputCompanyExtra : excessBalance;
    const companyExtra = paymentMode === "company_full"
        ? excessBalance
        : paymentMode === "company"
            ? Math.min(requestedCompanyExtra, companyExtraCapacity, excessBalance)
            : 0;
    const companyPaid = paymentMode === "employee_full" ? 0 : Math.min(ticketCost, companyBasePaid + companyExtra);
    let employeePaid = 0;
    let loanAmount = 0;
    let excess = 0;

    if (paymentMode === "employee_full") {
        employeePaid = ticketCost;
        excess = 0;
    } else if (paymentMode === "company_full") {
        excess = 0;
    } else if (paymentMode === "employee") {
        employeePaid = Math.min(inputEmployeePaid, excessBalance);
        excess = Math.max(0, excessBalance - employeePaid);
    } else if (paymentMode === "loan") {
        loanAmount = Math.min(inputLoanAmount, excessBalance);
        excess = Math.max(0, excessBalance - loanAmount);
    } else if (paymentMode === "company") {
        excess = Math.max(0, excessBalance - companyExtra);
    } else {
        excess = excessBalance;
    }

    const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
    return {
        ticketCost: roundMoney(ticketCost),
        entitlement: roundMoney(paymentMode === "employee_full" ? 0 : entitlement),
        companyPaid: roundMoney(paymentMode === "company_full" ? ticketCost : Math.min(companyPaid, ticketCost, companyMaxPayable)),
        excess: roundMoney(excess),
        employeePaid: roundMoney(employeePaid),
        loanAmount: roundMoney(loanAmount),
        companyExtra: roundMoney(companyExtra),
        companyBalancePayAmount: roundMoney(companyExtra),
        maxPayoutApplied: maxPayout
    };
}

function buildAllocationPayloadSchema() {
    return Joi.object({
        employeeId: Joi.number().integer().required(),
        date: Joi.date().required(),
        year: Joi.number().integer().min(2000).max(2100).required(),
        ticketCost: Joi.number().positive().required(),
        paymentMode: Joi.string().valid(...ALLOCATION_PAYMENT_MODES).required(),
        emi: Joi.number().min(0).max(999999).default(0),
        tenure: Joi.number().integer().min(0).max(120).default(0),
        decision: Joi.string().allow("process", "reject").default("process"),
        overrideReason: Joi.string().allow("", null).max(500),
        managerApproval: Joi.string().allow("", null).max(500),
        leaveStart: Joi.date().allow(null).allow(""),
        leaveEnd: Joi.date().allow(null).allow(""),
        route: Joi.string().allow("", null).max(300),
        ticketNo: Joi.string().allow("", null).max(120),
        supplier: Joi.string().allow("", null).max(200),
        invoiceNo: Joi.string().allow("", null).max(120),
        remarks: Joi.string().allow("", null).max(500),
        companyId: Joi.number().integer().allow(null),
        companyName: Joi.string().allow("", null),
        companyCode: Joi.string().allow("", null),
        companyLogoUrl: Joi.string().allow("", null)
    });
}

function toApiValidationError(error) {
    return { code: "INVALID_PAYLOAD", message: error?.details ? error.details[0]?.message || "Validation error" : "Invalid payload" };
}

function sqlIdentifier(name) {
    if (!/^[A-Za-z0-9_]+$/.test(name || '')) {
        throw new Error('Database name can use letters, numbers, and underscore only');
    }
    return `[${name.replace(/]/g, ']]')}]`;
}

function sqlLiteral(value) {
    return `N'${String(value || '').replace(/'/g, "''")}'`;
}

function companyDatabaseName(companyCode, requestedName) {
    const source = requestedName || `ATLAS_${companyCode}`;
    return source.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 120);
}

async function ensureCompanyDatabase(db, company) {
    const databaseName = companyDatabaseName(company.companyCode, company.databaseName);
    const safeDatabase = sqlIdentifier(databaseName);
    const profileTable = `${safeDatabase}.[dbo].[CompanyProfile]`;

    await db.request().query(`IF DB_ID(${sqlLiteral(databaseName)}) IS NULL CREATE DATABASE ${safeDatabase}`);
    await db.request().batch(`
        IF OBJECT_ID(${sqlLiteral(`${databaseName}.dbo.CompanyProfile`)}, 'U') IS NULL
        BEGIN
            CREATE TABLE ${profileTable} (
                CompanyID INT NOT NULL CONSTRAINT PK_CompanyProfile PRIMARY KEY,
                CompanyCode NVARCHAR(30) NOT NULL,
                CompanyName NVARCHAR(150) NOT NULL,
                Address NVARCHAR(300) NULL,
                Phone NVARCHAR(50) NULL,
                Email NVARCHAR(150) NULL,
                TRN NVARCHAR(50) NULL,
                ContactPerson NVARCHAR(120) NULL,
                UpdatedAt DATETIME2(0) NOT NULL
            );
        END;

        DELETE FROM ${profileTable};
        INSERT INTO ${profileTable}
            (CompanyID, CompanyCode, CompanyName, Address, Phone, Email, TRN, ContactPerson, UpdatedAt)
        VALUES
            (1, ${sqlLiteral(company.companyCode)}, ${sqlLiteral(company.companyName)}, ${sqlLiteral(company.address)},
             ${sqlLiteral(company.phone)}, ${sqlLiteral(company.email)}, ${sqlLiteral(company.trn)},
             ${sqlLiteral(company.contactPerson)}, SYSUTCDATETIME());
    `);

    return databaseName;
}

// =====================================================
// MIDDLEWARE
// =====================================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.sheetjs.com", "https://cdn.jsdelivr.net"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: null
        }
    }
}));
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
    if (req.path === '/' || req.path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store');
    }
    next();
});
app.use((req, res, next) => {
    if (!isFrontendRequest(req) || (req.method !== 'GET' && req.method !== 'HEAD')) {
        return next();
    }

    express.static(FRONTEND_BUILD_DIR, FRONTEND_STATIC_OPTIONS)(req, res, (err) => {
        if (err) {
            logger.error('Frontend static serving error', err);
            return sendUiUnavailable(req, res, "Frontend static serving error.");
        }

        if (hasFileExtension(req.path)) {
            return next();
        }

        return serveFrontendIndex(req, res);
    });
});
app.use(express.static(FRONTEND_BUILD_DIR, FRONTEND_STATIC_OPTIONS));

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.API_RATE_LIMIT_MAX, 10) || 5000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests in a short time. Please wait one minute, then use Refresh. Admin can increase API_RATE_LIMIT_MAX if needed.' }
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 100,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Too many login attempts. Please wait a few minutes or ask admin to unlock the user.' }
});
app.use('/api/auth', authLimiter);
app.use('/api/', apiLimiter);

app.get('/', (req, res) => {
    serveFrontendIndex(req, res);
});

app.get('/api/lan-check', (req, res) => {
    res.json({
        status: 'reachable',
        service: 'ATLAS Airfare HCM',
        host: req.headers.host || null,
        clientIp: req.ip,
        forwardedFor: req.headers['x-forwarded-for'] || null,
        protocol: req.protocol,
        timestamp: new Date().toISOString()
    });
});

// =====================================================
// JWT AUTHENTICATION MIDDLEWARE
// =====================================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// Role-based access control
function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

// =====================================================
// AUDIT LOG HELPER
// =====================================================
async function logAudit(userId, username, action, entityType, entityId, oldValues, newValues, description, req, status = 'success', errorMessage = null) {
    try {
        const db = await getConnection();
        await db.request()
            .input('UserID', sql.Int, userId)
            .input('Username', sql.NVarChar(50), username)
            .input('Action', sql.NVarChar(50), action)
            .input('EntityType', sql.NVarChar(30), entityType)
            .input('EntityID', sql.BigInt, entityId)
            .input('OldValues', sql.NVarChar(sql.MAX), oldValues ? JSON.stringify(oldValues) : null)
            .input('NewValues', sql.NVarChar(sql.MAX), newValues ? JSON.stringify(newValues) : null)
            .input('Description', sql.NVarChar(500), description)
            .input('IPAddress', sql.NVarChar(45), req.ip)
            .input('UserAgent', sql.NVarChar(500), req.headers['user-agent'])
            .input('SessionID', sql.NVarChar(100), req.headers['x-session-id'])
            .input('Status', sql.NVarChar(20), status)
            .input('ErrorMessage', sql.NVarChar(sql.MAX), errorMessage)
            .query(`INSERT INTO AuditLog (UserID, Username, Action, EntityType, EntityID, OldValues, NewValues, Description, IPAddress, UserAgent, SessionID, Status, ErrorMessage)
                    VALUES (@UserID, @Username, @Action, @EntityType, @EntityID, @OldValues, @NewValues, @Description, @IPAddress, @UserAgent, @SessionID, @Status, @ErrorMessage)`);
    } catch (err) {
        logger.error('Audit log failed:', err);
    }
}

function toLoanIdsCsv(loanIds) {
    if (!Array.isArray(loanIds)) return null;
    const ids = [...new Set(loanIds.map((id) => parseInt(id, 10)).filter((id) => Number.isInteger(id) && id > 0))];
    return ids.length ? ids.join(',') : null;
}

async function ensureAirfarePolicySql(db) {
    await db.request().batch(`
IF OBJECT_ID(N'dbo.AirfarePolicyRates', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AirfarePolicyRates (
        PolicyRateID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AirfarePolicyRates PRIMARY KEY,
        CompanyID INT NULL,
        EmployeeID INT NULL,
        Department NVARCHAR(100) NULL,
        EmpGroup NVARCHAR(100) NULL,
        EffectiveFrom DATE NOT NULL,
        EffectiveTo DATE NULL,
        MaxPayoutAmount DECIMAL(12,2) NOT NULL,
        CycleDays DECIMAL(10,2) NOT NULL CONSTRAINT DF_AirfarePolicyRates_CycleDays DEFAULT (60),
        WorkingDaysPerMonth DECIMAL(10,2) NOT NULL CONSTRAINT DF_AirfarePolicyRates_WorkingDaysPerMonth DEFAULT (30),
        AirfareDaysPerMonth DECIMAL(10,2) NOT NULL CONSTRAINT DF_AirfarePolicyRates_AirfareDaysPerMonth DEFAULT (2.5),
        IsActive BIT NOT NULL CONSTRAINT DF_AirfarePolicyRates_IsActive DEFAULT (1),
        CreatedBy INT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AirfarePolicyRates_CreatedAt DEFAULT SYSUTCDATETIME()
    );
END;

IF COL_LENGTH('dbo.AirfarePolicyRates', 'EmployeeID') IS NULL
BEGIN
    ALTER TABLE dbo.AirfarePolicyRates ADD EmployeeID INT NULL;
END;

IF COL_LENGTH('dbo.AirfarePolicyRates', 'Department') IS NULL
BEGIN
    ALTER TABLE dbo.AirfarePolicyRates ADD Department NVARCHAR(100) NULL;
END;

IF COL_LENGTH('dbo.AirfarePolicyRates', 'EmpGroup') IS NULL
BEGIN
    ALTER TABLE dbo.AirfarePolicyRates ADD EmpGroup NVARCHAR(100) NULL;
END;

IF COL_LENGTH('dbo.AirfarePolicyRates', 'IsActive') IS NULL
BEGIN
    ALTER TABLE dbo.AirfarePolicyRates ADD IsActive BIT NOT NULL CONSTRAINT DF_AirfarePolicyRates_IsActive_Live DEFAULT (1);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.AirfarePolicyRates') AND name = N'IX_ATLAS_AirfarePolicyRates_EffectiveScope')
BEGIN
    CREATE INDEX IX_ATLAS_AirfarePolicyRates_EffectiveScope
        ON dbo.AirfarePolicyRates (IsActive, EmployeeID, CompanyID, Department, EmpGroup, EffectiveFrom DESC, PolicyRateID DESC);
END;

IF COL_LENGTH('dbo.AirfarePolicyRates', 'IsActive') IS NOT NULL
BEGIN
    EXEC(N'
    ;WITH duplicatePolicyRows AS (
        SELECT
            PolicyRateID,
            IsActive,
            ROW_NUMBER() OVER (
                PARTITION BY
                    ISNULL(CompanyID, -1),
                    ISNULL(EmployeeID, -1),
                    ISNULL(Department, N''''),
                    ISNULL(EmpGroup, N''''),
                    EffectiveFrom
                ORDER BY PolicyRateID DESC
            ) AS rn
        FROM dbo.AirfarePolicyRates
        WHERE IsActive = 1
    )
    UPDATE duplicatePolicyRows
       SET IsActive = 0
     WHERE rn > 1;');
END;
`);

    await db.request().batch(`
CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetEffectiveAirfarePolicy
    @AllocationDate DATE,
    @CompanyID INT = NULL,
    @EmployeeID INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @date DATE = COALESCE(@AllocationDate, CONVERT(date, GETDATE()));
    DECLARE @EmployeeDepartment NVARCHAR(100) = NULL;
    DECLARE @EmployeeGroup NVARCHAR(100) = NULL;

    SELECT
        @EmployeeDepartment = NULLIF(LTRIM(RTRIM(Department)), N''),
        @EmployeeGroup = NULLIF(LTRIM(RTRIM(EmpGroup)), N'')
    FROM dbo.Employees
    WHERE EmployeeID = @EmployeeID;

    SELECT TOP 1
        PolicyRateID,
        CompanyID,
        EmployeeID,
        Department,
        EmpGroup,
        EffectiveFrom,
        EffectiveTo,
        MaxPayoutAmount,
        CycleDays,
        WorkingDaysPerMonth,
        AirfareDaysPerMonth,
        CAST(MaxPayoutAmount / NULLIF(CycleDays, 0) AS DECIMAL(12,6)) AS PerDayRate,
        IsActive,
        CreatedAt
    FROM dbo.AirfarePolicyRates
    WHERE IsActive = 1
      AND EffectiveFrom <= @date
      AND (EffectiveTo IS NULL OR EffectiveTo >= @date)
      AND (EmployeeID IS NULL OR EmployeeID = @EmployeeID)
      AND (CompanyID IS NULL OR CompanyID = @CompanyID)
      AND (Department IS NULL OR LOWER(Department) = LOWER(@EmployeeDepartment))
      AND (EmpGroup IS NULL OR LOWER(EmpGroup) = LOWER(@EmployeeGroup))
    ORDER BY
        CASE
            WHEN EmployeeID = @EmployeeID AND CompanyID IS NULL AND Department IS NULL AND EmpGroup IS NULL THEN 50
            WHEN EmployeeID = @EmployeeID THEN 45
            WHEN EmpGroup IS NOT NULL AND LOWER(EmpGroup) = LOWER(@EmployeeGroup) THEN 40
            WHEN Department IS NOT NULL AND LOWER(Department) = LOWER(@EmployeeDepartment) THEN 30
            WHEN EmployeeID IS NULL AND CompanyID = @CompanyID THEN 20
            ELSE 10
        END DESC,
        EffectiveFrom DESC,
        PolicyRateID DESC;
END;
`);

    await db.request().batch(`
CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_SaveAirfarePolicyRate
    @EffectiveFrom DATE,
    @MaxPayoutAmount DECIMAL(12,2),
    @CompanyID INT = NULL,
    @EmployeeID INT = NULL,
    @Department NVARCHAR(100) = NULL,
    @EmpGroup NVARCHAR(100) = NULL,
    @CreatedBy INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @EffectiveFrom IS NULL
        THROW 51000, 'Effective date is required.', 1;

    IF ISNULL(@MaxPayoutAmount, 0) <= 0
        THROW 51001, 'Airfare amount must be more than zero.', 1;

    SET @Department = NULLIF(LTRIM(RTRIM(@Department)), N'');
    SET @EmpGroup = NULLIF(LTRIM(RTRIM(@EmpGroup)), N'');

    UPDATE dbo.AirfarePolicyRates
       SET EffectiveTo = DATEADD(day, -1, @EffectiveFrom)
     WHERE IsActive = 1
       AND EffectiveFrom < @EffectiveFrom
       AND EffectiveTo IS NULL
       AND ((CompanyID = @CompanyID) OR (CompanyID IS NULL AND @CompanyID IS NULL))
       AND ((EmployeeID = @EmployeeID) OR (EmployeeID IS NULL AND @EmployeeID IS NULL))
       AND ((Department = @Department) OR (Department IS NULL AND @Department IS NULL))
       AND ((EmpGroup = @EmpGroup) OR (EmpGroup IS NULL AND @EmpGroup IS NULL));

    UPDATE dbo.AirfarePolicyRates
       SET IsActive = 0,
           EffectiveTo = CASE WHEN EffectiveTo IS NULL OR EffectiveTo >= @EffectiveFrom THEN @EffectiveFrom ELSE EffectiveTo END
     WHERE IsActive = 1
       AND EffectiveFrom = @EffectiveFrom
       AND ((CompanyID = @CompanyID) OR (CompanyID IS NULL AND @CompanyID IS NULL))
       AND ((EmployeeID = @EmployeeID) OR (EmployeeID IS NULL AND @EmployeeID IS NULL))
       AND ((Department = @Department) OR (Department IS NULL AND @Department IS NULL))
       AND ((EmpGroup = @EmpGroup) OR (EmpGroup IS NULL AND @EmpGroup IS NULL));

    INSERT INTO dbo.AirfarePolicyRates
        (CompanyID, EmployeeID, Department, EmpGroup, EffectiveFrom, EffectiveTo, MaxPayoutAmount, CycleDays, WorkingDaysPerMonth, AirfareDaysPerMonth, IsActive, CreatedBy)
    VALUES
        (@CompanyID, @EmployeeID, @Department, @EmpGroup, @EffectiveFrom, NULL, @MaxPayoutAmount, 60, 30, 2.5, 1, @CreatedBy);

    SELECT
        PolicyRateID,
        CompanyID,
        EmployeeID,
        Department,
        EmpGroup,
        EffectiveFrom,
        EffectiveTo,
        MaxPayoutAmount,
        CycleDays,
        WorkingDaysPerMonth,
        AirfareDaysPerMonth,
        CAST(MaxPayoutAmount / NULLIF(CycleDays, 0) AS DECIMAL(12,6)) AS PerDayRate,
        IsActive,
        CreatedAt
    FROM dbo.AirfarePolicyRates
    WHERE PolicyRateID = SCOPE_IDENTITY();
END;
`);
}

async function ensureLoanOperationSql(db) {
    await db.request().query(`
        IF EXISTS (
            SELECT 1
            FROM sys.check_constraints
            WHERE parent_object_id = OBJECT_ID('dbo.LoanHistory')
              AND definition LIKE '%PaymentType%'
              AND (definition NOT LIKE '%restructure%' OR definition NOT LIKE '%reversal%')
        )
        BEGIN
            DECLARE @constraintName SYSNAME;
            SELECT TOP 1 @constraintName = name
            FROM sys.check_constraints
            WHERE parent_object_id = OBJECT_ID('dbo.LoanHistory')
              AND definition LIKE '%PaymentType%'
              AND (definition NOT LIKE '%restructure%' OR definition NOT LIKE '%reversal%');
            IF @constraintName IS NOT NULL
            BEGIN
                DECLARE @sql NVARCHAR(MAX) = N'ALTER TABLE dbo.LoanHistory DROP CONSTRAINT ' + QUOTENAME(@constraintName);
                EXEC sp_executesql @sql;
            END
        END;
        IF NOT EXISTS (
            SELECT 1
            FROM sys.check_constraints
            WHERE parent_object_id = OBJECT_ID('dbo.LoanHistory')
              AND definition LIKE '%restructure%'
              AND definition LIKE '%reversal%'
        )
        BEGIN
            ALTER TABLE dbo.LoanHistory WITH CHECK ADD CONSTRAINT CK_ATLAS_LoanHistory_PaymentType
                CHECK (PaymentType IN ('create', 'emi', 'add', 'settle', 'defer', 'bulk', 'restructure', 'reversal'));
        END;
    `);
}

async function ensureAllocationPaymentSql(db) {
    await db.request().batch(`
DECLARE @paymentConstraint SYSNAME;
SELECT TOP (1) @paymentConstraint = cc.name
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID(N'dbo.Allocations')
  AND cc.definition LIKE N'%PaymentMode%'
  AND cc.definition NOT LIKE N'%employee_full%';

IF @paymentConstraint IS NOT NULL
BEGIN
    DECLARE @dropPaymentConstraintSql NVARCHAR(MAX) = N'ALTER TABLE dbo.Allocations DROP CONSTRAINT ' + QUOTENAME(@paymentConstraint);
    EXEC sp_executesql @dropPaymentConstraintSql;
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id = OBJECT_ID(N'dbo.Allocations')
      AND cc.definition LIKE N'%PaymentMode%'
      AND cc.definition LIKE N'%employee_full%'
)
BEGIN
    ALTER TABLE dbo.Allocations WITH CHECK ADD CONSTRAINT CK_Allocations_PaymentMode
    CHECK (PaymentMode IN ('entitlement', 'loan', 'employee', 'employee_full', 'company', 'company_full'));
END;
`);

    await db.request().batch(`
CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_NormalizeAllocationAmounts
    @TicketCost DECIMAL(10,2),
    @PolicyEntitlement DECIMAL(10,2),
    @MaximumPayout DECIMAL(10,2),
    @PaymentMode NVARCHAR(20),
    @EmployeePaid DECIMAL(10,2),
    @LoanAmount DECIMAL(10,2),
    @CompanyExtra DECIMAL(10,2),
    @CompanyPaid DECIMAL(10,2) OUTPUT,
    @EmployeePaidOut DECIMAL(10,2) OUTPUT,
    @LoanAmountOut DECIMAL(10,2) OUTPUT,
    @CompanyExtraOut DECIMAL(10,2) OUTPUT,
    @ExcessOut DECIMAL(10,2) OUTPUT,
    @EntitlementOut DECIMAL(10,2) OUTPUT,
    @CompanyBalancePayAmount DECIMAL(10,2) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @maxPayout DECIMAL(10,4) = CASE
        WHEN ISNULL(@MaximumPayout,0) <= 0 THEN 150
        WHEN @MaximumPayout > 150 THEN 150
        ELSE @MaximumPayout
    END;
    DECLARE @ticket DECIMAL(10,2) = ROUND(ISNULL(@TicketCost,0),2);
    DECLARE @entitlement DECIMAL(10,2) = ROUND(CASE WHEN ISNULL(@PolicyEntitlement,0) > 0 THEN @PolicyEntitlement ELSE 0 END,2);
    DECLARE @companyMaxPayable DECIMAL(10,2) = ROUND(@maxPayout,2);

    DECLARE @companyBasePaid DECIMAL(10,2) = IIF(@ticket < @entitlement, @ticket, IIF(@entitlement < @companyMaxPayable, @entitlement, @companyMaxPayable));
    DECLARE @excessBalance DECIMAL(10,2) = ROUND(IIF(@ticket - @companyBasePaid > 0, @ticket - @companyBasePaid, 0),2);
    DECLARE @companyExtraCapacity DECIMAL(10,2) = ROUND(CASE WHEN @companyMaxPayable - @companyBasePaid > 0 THEN @companyMaxPayable - @companyBasePaid ELSE 0 END,2);

    SET @paymentMode = LOWER(LTRIM(RTRIM(@PaymentMode)));
    SET @CompanyPaid = ROUND(CASE WHEN @companyBasePaid < @ticket THEN @companyBasePaid ELSE @ticket END,2);
    SET @EmployeePaidOut = 0;
    SET @LoanAmountOut = 0;
    SET @CompanyExtraOut = 0;
    SET @ExcessOut = 0;

    IF @paymentMode = N'employee_full'
    BEGIN
        SET @CompanyPaid = 0;
        SET @EmployeePaidOut = @ticket;
        SET @LoanAmountOut = 0;
        SET @CompanyExtraOut = 0;
        SET @ExcessOut = 0;
        SET @EntitlementOut = 0;
        SET @CompanyBalancePayAmount = 0;
        RETURN;
    END

    IF @paymentMode = N'company_full'
    BEGIN
        SET @CompanyExtraOut = @excessBalance;
        SET @CompanyPaid = @ticket;
        SET @ExcessOut = 0;
    END
    ELSE IF @paymentMode = N'company'
    BEGIN
        DECLARE @requestedCompanyExtra DECIMAL(10,2) = CASE
            WHEN ISNULL(@CompanyExtra,0) > 0 THEN ISNULL(@CompanyExtra,0)
            ELSE @excessBalance
        END;
        SET @CompanyExtraOut = ROUND(IIF(@requestedCompanyExtra < @companyExtraCapacity, @requestedCompanyExtra, @companyExtraCapacity),2);
        IF @CompanyExtraOut > @excessBalance SET @CompanyExtraOut = @excessBalance;
        SET @CompanyPaid = ROUND(IIF(@ticket < (@companyBasePaid + @CompanyExtraOut), @ticket, @companyBasePaid + @CompanyExtraOut),2);
        SET @ExcessOut = ROUND(IIF(@excessBalance - @CompanyExtraOut > 0, @excessBalance - @CompanyExtraOut, 0),2);
    END
    ELSE IF @paymentMode = N'employee'
    BEGIN
        SET @EmployeePaidOut = ROUND(IIF(ISNULL(@EmployeePaid,0) < @excessBalance, ISNULL(@EmployeePaid,0), @excessBalance),2);
        SET @ExcessOut = ROUND(IIF(@excessBalance - @EmployeePaidOut > 0, @excessBalance - @EmployeePaidOut, 0),2);
    END
    ELSE IF @paymentMode = N'loan'
    BEGIN
        SET @LoanAmountOut = ROUND(IIF(ISNULL(@LoanAmount,0) < @excessBalance, ISNULL(@LoanAmount,0), @excessBalance),2);
        SET @ExcessOut = ROUND(IIF(@excessBalance - @LoanAmountOut > 0, @excessBalance - @LoanAmountOut, 0),2);
    END
    ELSE
    BEGIN
        SET @ExcessOut = ROUND(@excessBalance,2);
    END

    IF @CompanyPaid > @ticket SET @CompanyPaid = @ticket;
    IF @paymentMode <> N'company_full' AND @CompanyPaid > @companyMaxPayable SET @CompanyPaid = @companyMaxPayable;

    SET @EntitlementOut = ROUND(@entitlement,2);
    SET @CompanyBalancePayAmount = ROUND(@CompanyExtraOut,2);
END;
`);

    await db.request().batch(`
CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetAllocationContext
    @EmployeeID INT,
    @AllocYear INT,
    @ExcludeAllocationID BIGINT = NULL,
    @AllocationDate DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        COUNT(*) AS TotalTickets,
        COALESCE(SUM(CASE WHEN ISNULL(PaymentMode, N'') = N'employee_full' THEN 0 ELSE COALESCE(Entitlement, 0) END), 0) AS CurrentYearSpending
    FROM Allocations
    WHERE EmployeeID = @EmployeeID
      AND AllocYear = @AllocYear
      AND (@ExcludeAllocationID IS NULL OR AllocationID <> @ExcludeAllocationID);

    SELECT TOP 1
        AllocationID,
        AllocationDate,
        TicketCost,
        Remarks
    FROM Allocations
    WHERE EmployeeID = @EmployeeID
      AND AllocYear = @AllocYear
      AND (@ExcludeAllocationID IS NULL OR AllocationID <> @ExcludeAllocationID)
    ORDER BY AllocationDate ASC, AllocationID ASC;

    SELECT TOP 1
        AllocationID,
        AllocationDate,
        TicketCost,
        Remarks
    FROM Allocations
    WHERE EmployeeID = @EmployeeID
      AND AllocYear = @AllocYear
      AND (@ExcludeAllocationID IS NULL OR AllocationID <> @ExcludeAllocationID)
      AND (@AllocationDate IS NULL OR AllocationDate <= @AllocationDate)
      AND COALESCE(Entitlement, 0) > 0
    ORDER BY AllocationDate DESC, AllocationID DESC;
END;
`);
}

async function ensureYearEndOperationSql(db) {
    await db.request().batch(`
CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetYearEndPreview
    @ClosedYear INT,
    @ClosingDate DATE,
    @EmployeeID INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @safeClosingDate DATE = COALESCE(@ClosingDate, DATEFROMPARTS(@ClosedYear, 12, 31));
    DECLARE @closeIndex INT = ((MONTH(@safeClosingDate) - 1) * 30) + IIF(DAY(@safeClosingDate) > 30, 30, DAY(@safeClosingDate));
    SET @closeIndex = CASE WHEN @closeIndex < 0 THEN 0 WHEN @closeIndex > 360 THEN 360 ELSE @closeIndex END;

    ;WITH YearEndBase AS (
        SELECT
            e.EmployeeID,
            e.EmployeeCode,
            e.FullName,
            e.Department,
            e.JoinDate,
            CASE
                WHEN COALESCE(NULLIF(policy.MaxPayoutAmount, 0), NULLIF(e.MaximumPayout, 0), 150) > 150 THEN 150
                ELSE COALESCE(NULLIF(policy.MaxPayoutAmount, 0), NULLIF(e.MaximumPayout, 0), 150)
            END AS MaximumPayout,
            COALESCE(NULLIF(policy.CycleDays, 0), 60) AS CycleDays,
            COALESCE(ob.OpeningDays, e.OpeningDays, 0) AS OpeningDays,
            COALESCE(ob.OpeningBHD, e.OpeningBHD, dbo.fn_ATLAS_AirfareAmount(COALESCE(ob.OpeningDays, e.OpeningDays, 0), COALESCE(NULLIF(e.MaximumPayout, 0), 150)), 0) AS OpeningBHD,
            COALESCE(e.AirfarePaidDays, 0) AS ManualPaidDays
        FROM dbo.Employees e
        LEFT JOIN dbo.OpeningBalances ob
            ON ob.EmployeeID = e.EmployeeID
           AND ob.BalanceYear = @ClosedYear
        OUTER APPLY (
            SELECT TOP 1 MaxPayoutAmount, CycleDays
            FROM dbo.AirfarePolicyRates
            WHERE IsActive = 1
              AND CompanyID IS NULL
              AND EmployeeID IS NULL
              AND Department IS NULL
              AND EmpGroup IS NULL
              AND EffectiveFrom <= @safeClosingDate
              AND (EffectiveTo IS NULL OR EffectiveTo >= @safeClosingDate)
            ORDER BY EffectiveFrom DESC, PolicyRateID DESC
        ) policy
        WHERE dbo.fn_ATLAS_IsAirfareEligibleEmployeeStatus(e.Status) = 1
          AND e.JoinDate <= @safeClosingDate
          AND (@EmployeeID IS NULL OR e.EmployeeID = @EmployeeID)
    ),
    YearEndCalc AS (
        SELECT
            b.*,
            CAST(b.MaximumPayout / NULLIF(b.CycleDays, 0) AS DECIMAL(12,6)) AS PerDayRate,
            CASE
                WHEN b.JoinDate IS NULL OR b.JoinDate < DATEFROMPARTS(@ClosedYear, 1, 1) THEN DATEFROMPARTS(@ClosedYear, 1, 1)
                WHEN b.JoinDate > @safeClosingDate THEN @safeClosingDate
                ELSE b.JoinDate
            END AS EarnStartDate
        FROM YearEndBase b
    )
    SELECT
        c.EmployeeID,
        c.EmployeeCode,
        c.FullName,
        c.Department,
        CAST(c.MaximumPayout AS DECIMAL(10,2)) AS MaximumPayout,
        CAST(c.OpeningDays AS DECIMAL(10,4)) AS OpeningDays,
        CAST(c.OpeningBHD AS DECIMAL(10,2)) AS OpeningBHD,
        CAST(ROUND((CASE
            WHEN @closeIndex <= (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) THEN 0
            ELSE (@closeIndex - (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) + 1) / 30.0 * 2.5
        END), 4) AS DECIMAL(10,4)) AS CurrentYearEarnedDays,
        CAST(ROUND((CASE
            WHEN @closeIndex <= (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) THEN 0
            ELSE (@closeIndex - (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) + 1) / 30.0 * 2.5
        END) * c.PerDayRate, 2) AS DECIMAL(10,2)) AS CurrentYearEarnedBHD,
        CAST(ROUND((COALESCE(spent.EntitlementApplied, 0) / NULLIF(c.PerDayRate, 0)) + COALESCE(c.ManualPaidDays, 0), 4) AS DECIMAL(10,4)) AS PaidDays,
        CAST(ROUND(COALESCE(spent.EntitlementApplied, 0) + (COALESCE(c.ManualPaidDays, 0) * c.PerDayRate), 2) AS DECIMAL(10,2)) AS PaidAmount,
        CAST(ROUND(CASE
            WHEN c.OpeningDays + (CASE
                WHEN @closeIndex <= (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) THEN 0
                ELSE (@closeIndex - (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) + 1) / 30.0 * 2.5
            END) - ((COALESCE(spent.EntitlementApplied, 0) / NULLIF(c.PerDayRate, 0)) + COALESCE(c.ManualPaidDays, 0)) < 0 THEN 0
            ELSE c.OpeningDays + (CASE
                WHEN @closeIndex <= (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) THEN 0
                ELSE (@closeIndex - (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) + 1) / 30.0 * 2.5
            END) - ((COALESCE(spent.EntitlementApplied, 0) / NULLIF(c.PerDayRate, 0)) + COALESCE(c.ManualPaidDays, 0))
        END, 4) AS DECIMAL(10,4)) AS ClosingDays,
        CAST(ROUND(CASE
            WHEN c.OpeningBHD + (CASE
                WHEN @closeIndex <= (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) THEN 0
                ELSE (@closeIndex - (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) + 1) / 30.0 * 2.5
            END * c.PerDayRate) - (COALESCE(spent.EntitlementApplied, 0) + (COALESCE(c.ManualPaidDays, 0) * c.PerDayRate)) < 0 THEN 0
            ELSE c.OpeningBHD + (CASE
                WHEN @closeIndex <= (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) THEN 0
                ELSE (@closeIndex - (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) + 1) / 30.0 * 2.5
            END * c.PerDayRate) - (COALESCE(spent.EntitlementApplied, 0) + (COALESCE(c.ManualPaidDays, 0) * c.PerDayRate))
        END, 2) AS DECIMAL(10,2)) AS ClosingBHD,
        COALESCE(loans.PendingLoanCount, 0) AS PendingLoanCount,
        CAST(ROUND(COALESCE(loans.PendingLoanAmount, 0), 2) AS DECIMAL(12,2)) AS PendingLoanAmount,
        CAST(ROUND(COALESCE(loans.MonthlyEMI, 0), 2) AS DECIMAL(12,2)) AS PendingMonthlyEMI,
        CASE
            WHEN COALESCE(loans.PendingLoanCount, 0) > 0 THEN 'Pending loan review required'
            ELSE 'Ready for close'
        END AS CloseStatus
    FROM YearEndCalc c
    OUTER APPLY (
        SELECT
            SUM(CASE
                WHEN COALESCE(a.Entitlement, 0) > 0 THEN IIF(a.Entitlement > a.TicketCost, a.TicketCost, a.Entitlement)
                WHEN ISNULL(a.PaymentMode, '') = 'company_full' THEN 0
                ELSE COALESCE(a.CompanyPaid, 0)
            END) AS EntitlementApplied
        FROM dbo.Allocations a
        WHERE a.EmployeeID = c.EmployeeID
          AND a.AllocYear = @ClosedYear
          AND a.AllocationDate <= @safeClosingDate
    ) spent
    OUTER APPLY (
        SELECT
            COUNT(*) AS PendingLoanCount,
            SUM(COALESCE(l.RemainingBalance, 0)) AS PendingLoanAmount,
            SUM(COALESCE(l.EMI, 0)) AS MonthlyEMI
        FROM dbo.Loans l
        WHERE l.EmployeeID = c.EmployeeID
          AND COALESCE(l.RemainingBalance, 0) > 0
          AND ISNULL(l.Status, 'active') <> 'settled'
          AND (l.CreatedDate IS NULL OR l.CreatedDate <= @safeClosingDate)
    ) loans
    ORDER BY c.EmployeeCode;
END
    `);
}

// =====================================================
// AUTH ROUTES
// =====================================================

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    const schema = Joi.object({
        username: Joi.string().required(),
        password: Joi.string().required()
    });

    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { username, password } = req.body;

    try {
        const db = await getConnection();
        const result = await db.request()
            .input('Username', sql.NVarChar(50), username)
            .query('SELECT * FROM Users WHERE Username = @Username AND IsActive = 1');

        const user = result.recordset[0];

        if (!user) {
            await logAudit(null, username, 'LOGIN', 'User', null, null, null, 'Failed login - user not found', req, 'failed');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check lockout
        if (user.LockedUntil && new Date(user.LockedUntil) > new Date()) {
            await logAudit(user.UserID, username, 'LOGIN', 'User', user.UserID, null, null, 'Failed login - account locked', req, 'failed');
            return res.status(423).json({ error: 'Account temporarily locked. Ask admin to unlock or wait a few minutes.' });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.PasswordHash);

        if (!validPassword) {
            // Increment login attempts
            const newAttempts = (user.LoginAttempts || 0) + 1;
            const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 20;
            const lockoutMinutes = parseInt(process.env.LOCKOUT_MINUTES, 10) || 5;

            if (newAttempts >= maxAttempts) {
                const lockUntil = new Date(Date.now() + lockoutMinutes * 60000);
                await db.request()
                    .input('UserID', sql.Int, user.UserID)
                    .input('Attempts', sql.Int, newAttempts)
                    .input('LockedUntil', sql.DateTime2, lockUntil)
                    .query('UPDATE Users SET LoginAttempts = @Attempts, LockedUntil = @LockedUntil WHERE UserID = @UserID');
            } else {
                await db.request()
                    .input('UserID', sql.Int, user.UserID)
                    .input('Attempts', sql.Int, newAttempts)
                    .query('UPDATE Users SET LoginAttempts = @Attempts WHERE UserID = @UserID');
            }

            await logAudit(user.UserID, username, 'LOGIN', 'User', user.UserID, null, null, 'Failed login - wrong password', req, 'failed');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Success - reset attempts and update last login
        await db.request()
            .input('UserID', sql.Int, user.UserID)
            .input('LastLogin', sql.DateTime2, new Date())
            .query('UPDATE Users SET LoginAttempts = 0, LockedUntil = NULL, LastLogin = @LastLogin WHERE UserID = @UserID');

        // Generate JWT
        const token = jwt.sign(
            { userId: user.UserID, username: user.Username, role: user.Role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
        );

        // Create session
        const sessionId = uuidv4();
        await db.request()
            .input('SessionID', sql.NVarChar(100), sessionId)
            .input('UserID', sql.Int, user.UserID)
            .input('TokenHash', sql.NVarChar(255), await bcrypt.hash(token, 5))
            .input('IPAddress', sql.NVarChar(45), req.ip)
            .input('UserAgent', sql.NVarChar(500), req.headers['user-agent'])
            .input('ExpiresAt', sql.DateTime2, new Date(Date.now() + 8 * 60 * 60 * 1000))
            .query(`INSERT INTO UserSessions (SessionID, UserID, TokenHash, IPAddress, UserAgent, ExpiresAt)
                    VALUES (@SessionID, @UserID, @TokenHash, @IPAddress, @UserAgent, @ExpiresAt)`);

        await logAudit(user.UserID, username, 'LOGIN', 'User', user.UserID, null, 
            { sessionId, role: user.Role }, 'Successful login', req, 'success');

        res.json({
            token,
            sessionId,
            user: {
                userId: user.UserID,
                username: user.Username,
                fullName: user.FullName,
                role: user.Role,
                email: user.Email,
                department: user.Department,
                branch: user.Branch
            }
        });

    } catch (err) {
        logger.error('Login error:', err);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// POST /api/auth/forgot-password
app.post('/api/auth/forgot-password', async (req, res) => {
    const schema = Joi.object({
        usernameOrEmail: Joi.string().max(150).required()
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
        const db = await getConnection();
        const userResult = await db.request()
            .input('Lookup', sql.NVarChar(150), value.usernameOrEmail)
            .query('SELECT TOP 1 UserID, Username, Email, FullName FROM Users WHERE (Username = @Lookup OR Email = @Lookup) AND IsActive = 1');

        if (userResult.recordset.length) {
            const user = userResult.recordset[0];
            const token = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            await db.request()
                .input('UserID', sql.Int, user.UserID)
                .input('Email', sql.NVarChar(150), user.Email)
                .input('TokenHash', sql.NVarChar(128), tokenHash)
                .query(`INSERT INTO dbo.PasswordResetTokens (UserID, Email, TokenHash, ExpiresAt)
                        VALUES (@UserID, @Email, @TokenHash, DATEADD(MINUTE, 30, SYSUTCDATETIME()))`);

            logger.info(`Password reset requested for ${user.Username}. Configure SMTP to email token ${token}.`);
        }

        res.json({ message: 'If the account exists, a reset request was recorded for email processing.' });
    } catch (err) {
        logger.error('Forgot password error:', err);
        res.status(500).json({ error: 'Password reset request failed' });
    }
});

// POST /api/auth/logout
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const sessionId = req.headers['x-session-id'];
        if (sessionId) {
            await db.request()
                .input('SessionID', sql.NVarChar(100), sessionId)
                .query('DELETE FROM UserSessions WHERE SessionID = @SessionID');
        }

        await logAudit(req.user.userId, req.user.username, 'LOGOUT', 'User', req.user.userId, null, null, 'User logged out', req);
        res.json({ message: 'Logged out successfully' });
    } catch (err) {
        logger.error('Logout error:', err);
        res.status(500).json({ error: 'Server error during logout' });
    }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const result = await db.request()
            .input('UserID', sql.Int, req.user.userId)
            .query('SELECT UserID, Username, FullName, Email, Role, Department, Branch, IsActive, LastLogin FROM Users WHERE UserID = @UserID');

        res.json(result.recordset[0]);
    } catch (err) {
        logger.error('Get user error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// =====================================================
// USER MANAGEMENT ROUTES
// =====================================================

// GET /api/users
app.get('/api/users', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const db = await getConnection();
        const result = await db.request().query(`
            SELECT UserID, Username, Email, FullName, Role, Department, Branch, IsActive, LastLogin, CreatedAt
            FROM Users
            ORDER BY IsActive DESC, Username
        `);
        res.json(result.recordset);
    } catch (err) {
        logger.error('Get users error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/users
app.post('/api/users', authenticateToken, requireRole('admin'), async (req, res) => {
    const schema = Joi.object({
        username: Joi.string().min(3).max(50).required(),
        password: Joi.string().min(8).required(),
        email: Joi.string().email().required(),
        fullName: Joi.string().max(100).required(),
        role: Joi.string().valid('admin', 'manager', 'hr', 'user', 'viewer').required(),
        department: Joi.string().allow('', null).max(50),
        branch: Joi.string().allow('', null).max(50),
        isActive: Joi.boolean().default(true)
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
        const db = await getConnection();
        const passwordHash = await bcrypt.hash(value.password, 12);
        const result = await db.request()
            .input('Username', sql.NVarChar(50), value.username)
            .input('PasswordHash', sql.NVarChar(255), passwordHash)
            .input('Email', sql.NVarChar(100), value.email)
            .input('FullName', sql.NVarChar(100), value.fullName)
            .input('Role', sql.NVarChar(20), value.role)
            .input('Department', sql.NVarChar(50), value.department || null)
            .input('Branch', sql.NVarChar(50), value.branch || null)
            .input('IsActive', sql.Bit, value.isActive ? 1 : 0)
            .input('CreatedBy', sql.Int, req.user.userId)
            .query(`INSERT INTO Users (Username, PasswordHash, Email, FullName, Role, Department, Branch, IsActive, CreatedBy)
                    OUTPUT INSERTED.UserID, INSERTED.Username, INSERTED.Email, INSERTED.FullName, INSERTED.Role, INSERTED.Department, INSERTED.Branch, INSERTED.IsActive, INSERTED.CreatedAt
                    VALUES (@Username, @PasswordHash, @Email, @FullName, @Role, @Department, @Branch, @IsActive, @CreatedBy)`);

        const newUser = result.recordset[0];
        await logAudit(req.user.userId, req.user.username, 'CREATE', 'User', newUser.UserID, null, newUser, `Created user ${value.username}`, req);
        res.status(201).json(newUser);
    } catch (err) {
        logger.error('Create user error:', err);
        if (err.message && (err.message.includes('UNIQUE') || err.message.includes('duplicate'))) {
            return res.status(409).json({ error: 'Username or email already exists' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/users/:id
app.put('/api/users/:id', authenticateToken, requireRole('admin'), async (req, res) => {
    const schema = Joi.object({
        password: Joi.string().min(8).allow('', null),
        email: Joi.string().email().required(),
        fullName: Joi.string().max(100).required(),
        role: Joi.string().valid('admin', 'manager', 'hr', 'user', 'viewer').required(),
        department: Joi.string().allow('', null).max(50),
        branch: Joi.string().allow('', null).max(50),
        isActive: Joi.boolean().required()
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
        const db = await getConnection();
        const oldResult = await db.request()
            .input('UserID', sql.Int, req.params.id)
            .query('SELECT UserID, Username, Email, FullName, Role, Department, Branch, IsActive FROM Users WHERE UserID = @UserID');
        const oldUser = oldResult.recordset[0];
        if (!oldUser) return res.status(404).json({ error: 'User not found' });

        const request = db.request()
            .input('UserID', sql.Int, req.params.id)
            .input('Email', sql.NVarChar(100), value.email)
            .input('FullName', sql.NVarChar(100), value.fullName)
            .input('Role', sql.NVarChar(20), value.role)
            .input('Department', sql.NVarChar(50), value.department || null)
            .input('Branch', sql.NVarChar(50), value.branch || null)
            .input('IsActive', sql.Bit, value.isActive ? 1 : 0)
            .input('UpdatedBy', sql.Int, req.user.userId);

        let passwordSql = '';
        if (value.password) {
            request.input('PasswordHash', sql.NVarChar(255), await bcrypt.hash(value.password, 12));
            passwordSql = ', PasswordHash = @PasswordHash, PasswordChangedAt = GETDATE()';
        }

        const updatedResult = await request.query(`UPDATE Users
            SET Email = @Email, FullName = @FullName, Role = @Role, Department = @Department, Branch = @Branch,
                IsActive = @IsActive, UpdatedAt = GETDATE(), UpdatedBy = @UpdatedBy ${passwordSql}
            OUTPUT INSERTED.UserID, INSERTED.Username, INSERTED.Email, INSERTED.FullName, INSERTED.Role,
                INSERTED.Department, INSERTED.Branch, INSERTED.IsActive, INSERTED.UpdatedAt
            WHERE UserID = @UserID`);

        const updatedUser = updatedResult.recordset[0];
        await logAudit(req.user.userId, req.user.username, 'UPDATE', 'User', req.params.id, oldUser, updatedUser, `Updated user ${oldUser.Username}`, req);
        res.json(updatedUser);
    } catch (err) {
        logger.error('Update user error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// =====================================================
// OPENING BALANCE ROUTES
// =====================================================

function amountFromDays(days, maxPayout) {
    return Math.round((clampAirfareMaximumPayout(maxPayout) / 60) * clampAirfareDays(days) * 100) / 100;
}

async function applyOpeningBalance(db, item, userId) {
    const year = Number(item.year) || new Date().getFullYear();
    const employeeId = Number(item.employeeId);
    const openingDays = clampAirfareDays(item.openingDays || item.days || 0);
    const maximumPayout = clampAirfareMaximumPayout(item.maximumPayout);
    const openingBhd = Number.isFinite(Number(item.openingBhd ?? item.amount))
        ? Number(item.openingBhd ?? item.amount)
        : amountFromDays(openingDays, maximumPayout);

    if (!employeeId || !Number.isFinite(openingDays)) {
        throw new Error('Employee and opening days are required');
    }

    await db.request()
        .input('EmployeeID', sql.Int, employeeId)
        .input('BalanceYear', sql.Int, year)
        .input('OpeningDays', sql.Decimal(10,2), openingDays)
        .input('OpeningBHD', sql.Decimal(10,2), openingBhd)
        .input('CarriedFromYear', sql.Int, item.carriedFromYear || year - 1)
        .query(`
            MERGE OpeningBalances AS target
            USING (SELECT @EmployeeID AS EmployeeID, @BalanceYear AS BalanceYear) AS source
            ON target.EmployeeID = source.EmployeeID AND target.BalanceYear = source.BalanceYear
            WHEN MATCHED THEN UPDATE SET OpeningDays = @OpeningDays, OpeningBHD = @OpeningBHD, CarriedFromYear = @CarriedFromYear
            WHEN NOT MATCHED THEN INSERT (EmployeeID, BalanceYear, OpeningDays, OpeningBHD, CarriedFromYear)
                VALUES (@EmployeeID, @BalanceYear, @OpeningDays, @OpeningBHD, @CarriedFromYear);
        `);

    const employeeResult = await db.request()
        .input('EmployeeID', sql.Int, employeeId)
        .input('OpeningDays', sql.Decimal(10,2), openingDays)
        .input('OpeningBHD', sql.Decimal(10,2), openingBhd)
        .input('MaximumPayout', sql.Decimal(10,2), maximumPayout)
        .input('UpdatedBy', sql.Int, userId)
        .query(`
            UPDATE Employees
            SET OpeningDays = @OpeningDays,
                OpeningBHD = @OpeningBHD,
                RemainingBalance = @OpeningDays,
                TotalAirfare = @OpeningBHD,
                MaximumPayout = @MaximumPayout,
                UpdatedAt = GETDATE(),
                UpdatedBy = @UpdatedBy
            OUTPUT INSERTED.*
            WHERE EmployeeID = @EmployeeID
        `);

    return employeeResult.recordset[0];
}

const openingBalancePayloadSchema = Joi.object({
    employeeId: Joi.number().integer().required(),
    year: Joi.number().integer().min(2000).max(2100).required(),
    openingDays: Joi.number().required(),
    openingBhd: Joi.number().min(0).allow(null),
    amount: Joi.number().min(0).allow(null),
    maximumPayout: Joi.number().min(0).max(150).default(150),
    carriedFromYear: Joi.number().integer().allow(null),
    note: Joi.string().allow("", null).max(250)
});

const openingBalanceImportSchema = Joi.object({
    rows: Joi.array().items(Joi.object({
        employeeCode: Joi.string().required(),
        year: Joi.number().integer().min(2000).max(2100).required(),
        openingDays: Joi.number().min(0).required(),
        openingBhd: Joi.number().min(0).required(),
        maximumPayout: Joi.number().min(0).max(150).default(150)
    })).min(1).required()
});

const openingBalanceImportPreviewSchema = Joi.object({
    fileName: Joi.string().allow("", null).max(260).default("Opening balance import"),
    headers: Joi.array().items(Joi.string().allow("", null)).default([]),
    rows: Joi.array().items(Joi.object({
        sourceRow: Joi.number().integer().allow(null),
        employeeCode: Joi.string().allow("", null),
        employeeName: Joi.string().allow("", null),
        year: Joi.number().integer().min(2000).max(2100).allow(null),
        openingDays: Joi.number().min(0).allow(null),
        openingBhd: Joi.number().min(0).allow(null),
        importedOpeningBhd: Joi.number().min(0).allow(null),
        maximumPayout: Joi.number().min(0).max(150).allow(null)
    }).unknown(true)).min(1).required()
}).unknown(true);

// GET /api/opening-balances
app.get('/api/opening-balances', authenticateToken, async (req, res) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const db = await getConnection();
        const result = await db.request()
            .input('Year', sql.Int, year)
            .query(`
                SELECT ob.*, e.EmployeeCode, e.FullName, e.Department, e.Branch, e.MaximumPayout
                FROM OpeningBalances ob
                JOIN Employees e ON e.EmployeeID = ob.EmployeeID
                WHERE ob.BalanceYear = @Year
                ORDER BY e.EmployeeCode
            `);
        res.json(result.recordset);
    } catch (err) {
        logger.error('Get opening balances error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/opening-balances
app.post('/api/opening-balances', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    try {
        const { error, value } = openingBalancePayloadSchema.validate(req.body);
        if (error) return res.status(400).json(toApiValidationError(error));

        const db = await getConnection();
        const employee = await applyOpeningBalance(db, value, req.user.userId);
        await logAudit(req.user.userId, req.user.username, 'UPSERT', 'OpeningBalance', value.employeeId, null, value,
            `Updated opening balance for employee ${value.employeeId}`, req);
        res.json(employee);
    } catch (err) {
        logger.error('Save opening balance error:', err);
        res.status(500).json({ error: err.message || 'Opening balance save failed' });
    }
});

// POST /api/opening-balances/import
app.post('/api/opening-balances/import', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    try {
        const { error, value } = openingBalanceImportSchema.validate(req.body);
        if (error) return res.status(400).json(toApiValidationError(error));
        const rows = value.rows;

        const db = await getConnection();
        const employees = await db.request().query('SELECT EmployeeID, EmployeeCode, MaximumPayout FROM Employees');
        const byCode = new Map(employees.recordset.map((employee) => [String(employee.EmployeeCode).trim().toLowerCase(), employee]));
        let updated = 0;
        const errors = [];

        for (const row of rows) {
            try {
                const employee = byCode.get(String(row.employeeCode || row.code || '').trim().toLowerCase());
                if (!employee) throw new Error(`Employee code not found: ${row.employeeCode || row.code}`);
                await applyOpeningBalance(db, {
                    ...row,
                    employeeId: employee.EmployeeID,
                    maximumPayout: row.maximumPayout || employee.MaximumPayout
                }, req.user.userId);
                updated++;
            } catch (error) {
                errors.push({ row, error: error.message });
            }
        }

        await logAudit(req.user.userId, req.user.username, 'IMPORT', 'OpeningBalance', null, null, { updated, errors: errors.length },
            `Imported opening balances for ${updated} employees`, req);
        res.json({ updated, errors });
    } catch (err) {
        logger.error('Import opening balances error:', err);
        res.status(500).json({ error: err.message || 'Opening balance import failed' });
    }
});

app.post('/api/opening-balances/import-preview', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    const { error, value } = openingBalanceImportPreviewSchema.validate(req.body || {});
    if (error) return res.status(400).json(toApiValidationError(error));

    try {
        const db = await getConnection();
        const rowsForPreview = value.rows
            .filter((row) => String(row.employeeCode || '').trim() || Number(row.openingDays || 0) > 0)
            .map((row) => ({
                ...row,
                openingBhd: Math.round(((Number(row.maximumPayout || 150) / 60) * Number(row.openingDays || 0) + Number.EPSILON) * 100) / 100
            }));
        if (!rowsForPreview.length) return res.status(400).json({ error: 'No opening balance rows found after skipping blank lines.' });
        const result = await db.request()
            .input('FileName', sql.NVarChar(260), value.fileName || 'Opening balance import')
            .input('HeadersJson', sql.NVarChar(sql.MAX), JSON.stringify(value.headers || []))
            .input('RowsJson', sql.NVarChar(sql.MAX), JSON.stringify(rowsForPreview))
            .input('UserID', sql.Int, req.user.userId)
            .execute('dbo.sp_ATLAS_CreateOpeningBalanceImportPreview');

        const batch = result.recordsets?.[0]?.[0] || null;
        const rows = result.recordsets?.[1] || [];
        res.json({
            batch,
            rows: rows.map((row) => ({
                importBatchRowId: Number(row.ImportBatchRowID),
                importBatchId: Number(row.ImportBatchID),
                sourceRow: Number(row.SourceRow),
                employeeCode: row.EmployeeCode || '',
                employeeName: row.EmployeeName || '',
                year: row.BalanceYear,
                openingDays: row.OpeningDays,
                openingBhd: row.OpeningBHD,
                maximumPayout: row.MaximumPayout,
                status: row.Status,
                action: row.ActionName || '',
                severity: row.Severity,
                message: row.Message,
                selected: Boolean(row.Selected)
            }))
        });
    } catch (err) {
        logger.error('Opening balance import preview error:', err);
        res.status(500).json({ error: err.message || 'Opening balance import preview failed' });
    }
});

app.post('/api/opening-balances/import-confirm', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    const { error, value } = Joi.object({
        importBatchId: Joi.number().integer().min(1).required(),
        rowIds: Joi.array().items(Joi.number().integer().min(1)).min(1).required()
    }).validate(req.body || {});
    if (error) return res.status(400).json(toApiValidationError(error));

    try {
        const db = await getConnection();
        const selectedRowsJson = JSON.stringify(value.rowIds);
        const selectedResult = await db.request()
            .input('ImportBatchID', sql.BigInt, value.importBatchId)
            .input('SelectedRowsJson', sql.NVarChar(sql.MAX), selectedRowsJson)
            .query(`
                DECLARE @Selected TABLE (ImportBatchRowID BIGINT PRIMARY KEY);
                INSERT INTO @Selected (ImportBatchRowID)
                SELECT TRY_CONVERT(BIGINT, value)
                FROM OPENJSON(@SelectedRowsJson)
                WHERE TRY_CONVERT(BIGINT, value) IS NOT NULL;

                UPDATE dbo.OpeningBalanceImportBatchRows
                SET Selected = CASE WHEN s.ImportBatchRowID IS NULL THEN 0 ELSE 1 END
                FROM dbo.OpeningBalanceImportBatchRows r
                LEFT JOIN @Selected s ON s.ImportBatchRowID = r.ImportBatchRowID
                WHERE r.ImportBatchID = @ImportBatchID;

                SELECT
                    r.ImportBatchRowID,
                    r.SourceRow,
                    e.EmployeeID,
                    r.EmployeeCode,
                    r.BalanceYear,
                    r.OpeningDays,
                    r.OpeningBHD,
                    COALESCE(NULLIF(r.MaximumPayout, 0), e.MaximumPayout, 150) AS MaximumPayout
                FROM dbo.OpeningBalanceImportBatchRows r
                INNER JOIN Employees e ON e.EmployeeCode = LEFT(r.EmployeeCode, 20)
                WHERE r.ImportBatchID = @ImportBatchID
                  AND r.Selected = 1
                  AND r.Severity <> 'ERROR'
                ORDER BY r.SourceRow, r.ImportBatchRowID;
            `);

        const rows = selectedResult.recordset || [];
        if (!rows.length) {
            return res.status(400).json({ error: 'No valid selected opening balance rows are ready for import.' });
        }

        let updated = 0;
        const errors = [];
        for (const row of rows) {
            try {
                await applyOpeningBalance(db, {
                    employeeId: row.EmployeeID,
                    year: row.BalanceYear,
                    openingDays: row.OpeningDays,
                    openingBhd: row.OpeningBHD,
                    maximumPayout: row.MaximumPayout
                }, req.user.userId);
                updated++;
            } catch (rowError) {
                errors.push({ row: row.SourceRow, code: row.EmployeeCode, error: rowError.message });
            }
        }

        await db.request()
            .input('ImportBatchID', sql.BigInt, value.importBatchId)
            .input('UpdatedRows', sql.Int, updated)
            .input('SelectedRows', sql.Int, rows.length)
            .input('ConfirmedBy', sql.Int, req.user.userId)
            .query(`
                UPDATE dbo.OpeningBalanceImportBatches
                SET UpdatedRows = @UpdatedRows,
                    SelectedRows = @SelectedRows,
                    Status = 'IMPORTED',
                    ConfirmedAt = GETDATE(),
                    ConfirmedBy = @ConfirmedBy
                WHERE ImportBatchID = @ImportBatchID;
            `);

        await logAudit(req.user.userId, req.user.username, 'IMPORT_CONFIRM', 'OpeningBalance', value.importBatchId, null,
            { updated, errors: errors.length, selectedRows: rows.length }, `Confirmed opening balance import batch #${value.importBatchId}`, req);

        res.json({ importBatchId: value.importBatchId, updated, selectedRows: rows.length, errors });
    } catch (err) {
        logger.error('Opening balance import confirm error:', err);
        res.status(500).json({ error: err.message || 'Opening balance import confirmation failed' });
    }
});

// =====================================================
// EMPLOYEE ROUTES
// =====================================================

const employeePayloadSchema = Joi.object({
    code: Joi.string().trim().max(20).required(),
    name: Joi.string().trim().max(120).required(),
    joinDate: Joi.date().allow("", null),
    cpr: Joi.string().allow("", null).max(20),
    passport: Joi.string().allow("", null).max(20),
    nationality: Joi.string().allow("", null).max(30),
    bhStatus: Joi.string().allow("", null).max(10),
    branch: Joi.string().allow("", null).max(50),
    department: Joi.string().allow("", null).max(50),
    section: Joi.string().allow("", null).max(50),
    location: Joi.string().allow("", null).max(50),
    designation: Joi.string().allow("", null).max(50),
    group: Joi.string().allow("", null).max(EMPLOYEE_GROUP_MAX_LENGTH),
    bankCode: Joi.string().allow("", null).max(20),
    jobBand: Joi.string().allow("", null).max(60),
    company: Joi.string().allow("", null).max(80),
    reportingTo: Joi.string().allow("", null).max(100),
    basicSalary: Joi.number().min(0).allow(null),
    hra: Joi.number().min(0).allow(null),
    specialDutyAllowance: Joi.number().min(0).allow(null),
    carAllowance: Joi.number().min(0).allow(null),
    petrolAllowance: Joi.number().min(0).allow(null),
    phoneAllowance: Joi.number().min(0).allow(null),
    grossSalary: Joi.number().min(0).allow(null),
    gosiDeduction: Joi.number().min(0).allow(null),
    religion: Joi.string().allow("", null).max(30),
    lastWorkingDate: Joi.date().allow("", null),
    payrollStatus: Joi.string().allow("", null).max(30),
    averageSalary: Joi.number().allow(null),
    serialNo: Joi.number().integer().allow(null),
    accountNumber: Joi.string().allow("", null).max(50),
    passportExpiryDate: Joi.date().allow("", null),
    email: Joi.string().email().allow("", null).max(120),
    whatsappNumber: Joi.string().allow("", null).max(30),
    status: Joi.string().allow("", null).max(20),
    openingDays: Joi.number().min(0).max(60).default(0),
    openingBhd: Joi.number().min(0).default(0),
    currentAirfare2024: Joi.number().min(0).max(30).default(0),
    airfarePaidDays: Joi.number().min(0).max(60).default(0),
    remainingBalance2024: Joi.number().min(0).max(60).default(0),
    maximumPayout: Joi.number().min(0).max(150).default(150),
    totalAirfare2024: Joi.number().min(0).default(0),
    jan: Joi.number().min(0).default(30),
    feb: Joi.number().min(0).default(30),
    mar: Joi.number().min(0).default(30),
    apr: Joi.number().min(0).default(30),
    may: Joi.number().min(0).default(30),
    jun: Joi.number().min(0).default(30),
    jul: Joi.number().min(0).default(30),
    aug: Joi.number().min(0).default(30),
    sep: Joi.number().min(0).default(30),
    oct: Joi.number().min(0).default(30),
    nov: Joi.number().min(0).default(30),
    dec: Joi.number().min(0).default(30),
    totalWorkingDays: Joi.number().min(0).max(360).default(360)
}).unknown(true);

const employeeImportSchema = Joi.object({
    rows: Joi.array().items(employeePayloadSchema.fork(
        ["code", "name"],
        (schema) => schema.required()
    )).min(1).required()
});

// GET /api/employees
app.get('/api/employees', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const requestedScope = String(req.query.scope || req.query.statusScope || 'active').trim().toLowerCase();
        const statusScope = ['all', 'inactive', 'ineligible'].includes(requestedScope) ? requestedScope : 'active';
        const result = await withSqlRetry(() => db.request()
            .input('StatusScope', sql.NVarChar(20), statusScope)
            .execute('dbo.sp_ATLAS_GetEmployeeMasterForScreen'), 'get employees');
        const rows = result.recordset || [];
        if (rows.length && !Object.prototype.hasOwnProperty.call(rows[0], 'WhatsAppNumber')) {
            const employeeIds = rows.map((row) => Number(row.EmployeeID)).filter((id) => Number.isInteger(id) && id > 0);
            if (employeeIds.length) {
                const whatsappRequest = db.request();
                const clause = buildInClause(whatsappRequest, employeeIds, 'whatsAppEmployee');
                const whatsappRows = clause.clause
                    ? await whatsappRequest.query(`SELECT EmployeeID, WhatsAppNumber FROM Employees WHERE EmployeeID IN (${clause.clause})`)
                    : { recordset: [] };
                const byEmployeeId = new Map((whatsappRows.recordset || []).map((row) => [Number(row.EmployeeID), row.WhatsAppNumber || null]));
                rows.forEach((row) => {
                    row.WhatsAppNumber = byEmployeeId.get(Number(row.EmployeeID)) || null;
                });
            }
        }
        res.json(rows);
    } catch (err) {
        logger.error('Get employees error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/employees/:id
app.get('/api/employees/:id', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const result = await db.request()
            .input('EmployeeID', sql.Int, req.params.id)
            .query('SELECT * FROM Employees WHERE EmployeeID = @EmployeeID');

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        res.json(result.recordset[0]);
    } catch (err) {
        logger.error('Get employee error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/employees
app.post('/api/employees', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    const { error, value } = employeePayloadSchema.validate(req.body);
    if (error) return res.status(400).json(toApiValidationError(error));
    const emp = value;
    try {
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const result = await db.request()
            .input('EmployeeCode', sql.NVarChar(20), emp.code)
            .input('FullName', sql.NVarChar(100), emp.name)
            .input('JoinDate', sql.Date, emp.joinDate || null)
            .input('CPR', sql.NVarChar(20), emp.cpr || null)
            .input('Passport', sql.NVarChar(20), emp.passport || null)
            .input('Nationality', sql.NVarChar(30), emp.nationality || null)
            .input('BHStatus', sql.NVarChar(10), emp.bhStatus || 'NON-BH')
            .input('Branch', sql.NVarChar(50), emp.branch || null)
            .input('Department', sql.NVarChar(50), emp.department || null)
            .input('Section', sql.NVarChar(50), emp.section || null)
            .input('Location', sql.NVarChar(50), emp.location || null)
            .input('Designation', sql.NVarChar(50), emp.designation || null)
            .input('EmpGroup', sql.NVarChar(EMPLOYEE_GROUP_MAX_LENGTH), emp.group || null)
            .input('BankCode', sql.NVarChar(20), emp.bankCode || null)
            .input('JobBand', sql.NVarChar(60), emp.jobBand || null)
            .input('Company', sql.NVarChar(80), emp.company || null)
            .input('ReportingTo', sql.NVarChar(100), emp.reportingTo || null)
            .input('BasicSalary', sql.Decimal(12,2), emp.basicSalary || null)
            .input('HRA', sql.Decimal(12,2), emp.hra || null)
            .input('SpecialDutyAllowance', sql.Decimal(12,2), emp.specialDutyAllowance || null)
            .input('CarAllowance', sql.Decimal(12,2), emp.carAllowance || null)
            .input('PetrolAllowance', sql.Decimal(12,2), emp.petrolAllowance || null)
            .input('PhoneAllowance', sql.Decimal(12,2), emp.phoneAllowance || null)
            .input('GrossSalary', sql.Decimal(12,2), emp.grossSalary || null)
            .input('GOSIDeduction', sql.Decimal(12,2), emp.gosiDeduction || null)
            .input('Religion', sql.NVarChar(30), emp.religion || null)
            .input('LastWorkingDate', sql.Date, emp.lastWorkingDate || null)
            .input('PayrollStatus', sql.NVarChar(30), emp.payrollStatus || null)
            .input('AverageSalary', sql.Decimal(12,2), emp.averageSalary || null)
            .input('SerialNo', sql.Int, emp.serialNo || null)
            .input('AccountNumber', sql.NVarChar(50), emp.accountNumber || null)
            .input('PassportExpiryDate', sql.Date, emp.passportExpiryDate || null)
            .input('Email', sql.NVarChar(120), emp.email || null)
            .input('WhatsAppNumber', sql.NVarChar(30), emp.whatsappNumber || null)
            .input('Status', sql.NVarChar(10), emp.status || 'Active')
            .input('OpeningDays', sql.Decimal(10,2), emp.openingDays || 0)
            .input('OpeningBHD', sql.Decimal(10,2), emp.openingBhd || 0)
            .input('CurrentAirfareRate', sql.Decimal(10,2), emp.currentAirfare2024 || 30)
            .input('AirfarePaidDays', sql.Decimal(10,2), emp.airfarePaidDays || 0)
            .input('RemainingBalance', sql.Decimal(10,2), emp.remainingBalance2024 || 0)
            .input('MaximumPayout', sql.Decimal(10,2), emp.maximumPayout || 150)
            .input('TotalAirfare', sql.Decimal(10,2), emp.totalAirfare2024 || 0)
            .input('JanDays', sql.Decimal(5,2), emp.jan || 30)
            .input('FebDays', sql.Decimal(5,2), emp.feb || 30)
            .input('MarDays', sql.Decimal(5,2), emp.mar || 30)
            .input('AprDays', sql.Decimal(5,2), emp.apr || 30)
            .input('MayDays', sql.Decimal(5,2), emp.may || 30)
            .input('JunDays', sql.Decimal(5,2), emp.jun || 30)
            .input('JulDays', sql.Decimal(5,2), emp.jul || 30)
            .input('AugDays', sql.Decimal(5,2), emp.aug || 30)
            .input('SepDays', sql.Decimal(5,2), emp.sep || 30)
            .input('OctDays', sql.Decimal(5,2), emp.oct || 30)
            .input('NovDays', sql.Decimal(5,2), emp.nov || 30)
            .input('DecDays', sql.Decimal(5,2), emp.dec || 30)
            .input('TotalWorkingDays', sql.Decimal(10,2), 
                (emp.jan||0)+(emp.feb||0)+(emp.mar||0)+(emp.apr||0)+(emp.may||0)+(emp.jun||0)+
                (emp.jul||0)+(emp.aug||0)+(emp.sep||0)+(emp.oct||0)+(emp.nov||0)+(emp.dec||0))
            .input('CreatedBy', sql.Int, req.user.userId)
            .query(`INSERT INTO Employees (EmployeeCode, FullName, JoinDate, CPR, Passport, Nationality, BHStatus, Branch, Department, Section, Location, Designation, EmpGroup,
                    BankCode, JobBand, Company, ReportingTo, BasicSalary, HRA, SpecialDutyAllowance, CarAllowance, PetrolAllowance, PhoneAllowance, GrossSalary, GOSIDeduction,
                    Religion, LastWorkingDate, PayrollStatus, AverageSalary, SerialNo, AccountNumber, PassportExpiryDate, Email, WhatsAppNumber, Status,
                    OpeningDays, OpeningBHD, CurrentAirfareRate, AirfarePaidDays, RemainingBalance, MaximumPayout, TotalAirfare,
                    JanDays, FebDays, MarDays, AprDays, MayDays, JunDays, JulDays, AugDays, SepDays, OctDays, NovDays, DecDays, TotalWorkingDays, CreatedBy)
                    OUTPUT INSERTED.*
                    VALUES (@EmployeeCode, @FullName, @JoinDate, @CPR, @Passport, @Nationality, @BHStatus, @Branch, @Department, @Section, @Location, @Designation, @EmpGroup,
                    @BankCode, @JobBand, @Company, @ReportingTo, @BasicSalary, @HRA, @SpecialDutyAllowance, @CarAllowance, @PetrolAllowance, @PhoneAllowance, @GrossSalary, @GOSIDeduction,
                    @Religion, @LastWorkingDate, @PayrollStatus, @AverageSalary, @SerialNo, @AccountNumber, @PassportExpiryDate, @Email, @WhatsAppNumber, @Status,
                    @OpeningDays, @OpeningBHD, @CurrentAirfareRate, @AirfarePaidDays, @RemainingBalance, @MaximumPayout, @TotalAirfare,
                    @JanDays, @FebDays, @MarDays, @AprDays, @MayDays, @JunDays, @JulDays, @AugDays, @SepDays, @OctDays, @NovDays, @DecDays, @TotalWorkingDays, @CreatedBy)`);

        const newEmp = result.recordset[0];
        await logAudit(req.user.userId, req.user.username, 'CREATE', 'Employee', newEmp.EmployeeID, null, newEmp, 
            `Created employee ${emp.code}`, req);

        res.status(201).json(newEmp);
    } catch (err) {
        logger.error('Create employee error:', err);
        if (err.message && err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Employee code already exists' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

const bulkDeleteEmployeesSchema = Joi.object({
    employeeIds: Joi.array().items(Joi.number().integer().min(1)).min(1).max(200).required()
});

app.post('/api/employees/bulk-delete', authenticateToken, requireRole('admin'), async (req, res) => {
    const { error, value } = bulkDeleteEmployeesSchema.validate(req.body || {});
    if (error) return res.status(400).json(toApiValidationError(error));

    const ids = toIntegerArray(value.employeeIds);
    if (!ids.length) return res.status(400).json(toApiValidationError({ details: [{ message: 'employeeIds must contain valid positive integers.' }] }));

    const db = await getConnection();
    const transaction = new sql.Transaction(db);
    const result = {
        requested: ids.length,
        deletedCount: 0,
        blocked: [],
        notFound: [],
        deleted: [],
        notFoundEmployeeIds: []
    };

    try {
        const linkRequest = new sql.Request(db);
        const linkClause = buildInClause(linkRequest, ids, "deleteLink");
        const existingQuery = linkClause.clause.length
            ? `
                SELECT
                    e.EmployeeID,
                    e.EmployeeCode,
                    e.FullName,
                    (SELECT COUNT(*) FROM Loans WHERE EmployeeID = e.EmployeeID) AS Loans,
                    (SELECT COUNT(*) FROM Allocations WHERE EmployeeID = e.EmployeeID) AS Allocations,
                    (SELECT COUNT(*) FROM EmergencyTickets WHERE EmployeeID = e.EmployeeID) AS EmergencyTickets,
                    (SELECT COUNT(*) FROM OpeningBalances WHERE EmployeeID = e.EmployeeID) AS OpeningBalances
                FROM Employees e
                WHERE e.EmployeeID IN (${linkClause.clause})
            `
            : "SELECT NULL WHERE 1 = 0";
        const contextResult = await linkRequest.query(existingQuery);

        const contextRows = contextResult.recordset || [];
        const existingMap = new Map(contextRows.map((row) => [Number(row.EmployeeID), row]));
        const existingIds = new Set(existingMap.keys());

        ids.forEach((employeeId) => {
            if (!existingIds.has(employeeId)) {
                result.notFound.push(employeeId);
                result.notFoundEmployeeIds.push(employeeId);
            }
        });

        const deletableIds = contextRows
            .filter((row) => (Number(row.Loans) + Number(row.Allocations) + Number(row.EmergencyTickets) + Number(row.OpeningBalances)) === 0)
            .map((row) => Number(row.EmployeeID));
        const blockedRows = contextRows.filter((row) => !deletableIds.includes(Number(row.EmployeeID)));
        result.blocked = blockedRows.map((row) => ({
            employeeId: Number(row.EmployeeID),
            employeeCode: row.EmployeeCode,
            fullName: row.FullName,
            loans: Number(row.Loans),
            allocations: Number(row.Allocations),
            emergencyTickets: Number(row.EmergencyTickets),
            openingBalances: Number(row.OpeningBalances)
        }));

        if (deletableIds.length > 0) {
            await transaction.begin();

            const transactionRequest = new sql.Request(transaction);
            const deleteClause = buildInClause(transactionRequest, deletableIds, "deleteTarget");
            const deleteQuery = `
                DELETE e
                FROM Employees e
                WHERE e.EmployeeID IN (${deleteClause.clause});
            `;
            const deleteResult = await transactionRequest.query(deleteQuery);
            result.deletedCount = deleteResult.rowsAffected?.[0] || 0;

            result.deleted = contextRows
                .filter((row) => deletableIds.includes(Number(row.EmployeeID)))
                .map((row) => ({
                    employeeId: Number(row.EmployeeID),
                    employeeCode: row.EmployeeCode,
                    fullName: row.FullName
                }));

            const auditItems = result.deleted.map((entry) => ({
                employeeId: entry.employeeId,
                employeeCode: entry.employeeCode,
                fullName: entry.fullName
            }));
            for (const auditEntry of auditItems) {
                await logAudit(req.user.userId, req.user.username, 'DELETE', 'Employee', auditEntry.employeeId, { employeeCode: auditEntry.employeeCode, fullName: auditEntry.fullName }, null,
                    `Deleted employee ${auditEntry.employeeCode}`, req);
            }

            await transaction.commit();
        } else {
            await transaction.begin();
            await transaction.commit();
        }

        res.json(result);
    } catch (err) {
        try { await transaction.rollback(); } catch (_) { /* noop */ }
        logger.error('Bulk delete employees error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/auth/login', (_req, res) => {
    res.status(405).json({ error: "Method not allowed. Use POST /api/auth/login with username and password." });
});

// PUT /api/employees/:id
app.put('/api/employees/:id', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    const { error, value } = employeePayloadSchema.validate(req.body);
    if (error) return res.status(400).json(toApiValidationError(error));
    const emp = value;
    try {
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);

        // Get old values for audit
        const oldResult = await db.request()
            .input('EmployeeID', sql.Int, req.params.id)
            .query('SELECT * FROM Employees WHERE EmployeeID = @EmployeeID');
        const oldValues = oldResult.recordset[0];

        if (!oldValues) return res.status(404).json({ error: 'Employee not found' });

        const manageOpening = Object.prototype.hasOwnProperty.call(emp, 'openingDays') || Object.prototype.hasOwnProperty.call(emp, 'openingBhd');
        const result = await db.request()
            .input('EmployeeID', sql.Int, req.params.id)
            .input('FullName', sql.NVarChar(100), emp.name)
            .input('JoinDate', sql.Date, emp.joinDate || null)
            .input('CPR', sql.NVarChar(20), emp.cpr || null)
            .input('Passport', sql.NVarChar(20), emp.passport || null)
            .input('Nationality', sql.NVarChar(30), emp.nationality || null)
            .input('BHStatus', sql.NVarChar(10), emp.bhStatus || 'NON-BH')
            .input('Branch', sql.NVarChar(50), emp.branch || null)
            .input('Department', sql.NVarChar(50), emp.department || null)
            .input('Section', sql.NVarChar(50), emp.section || null)
            .input('Location', sql.NVarChar(50), emp.location || null)
            .input('Designation', sql.NVarChar(50), emp.designation || null)
            .input('EmpGroup', sql.NVarChar(EMPLOYEE_GROUP_MAX_LENGTH), emp.group || null)
            .input('BankCode', sql.NVarChar(20), emp.bankCode || null)
            .input('JobBand', sql.NVarChar(60), emp.jobBand || null)
            .input('Company', sql.NVarChar(80), emp.company || null)
            .input('ReportingTo', sql.NVarChar(100), emp.reportingTo || null)
            .input('BasicSalary', sql.Decimal(12,2), emp.basicSalary || null)
            .input('HRA', sql.Decimal(12,2), emp.hra || null)
            .input('SpecialDutyAllowance', sql.Decimal(12,2), emp.specialDutyAllowance || null)
            .input('CarAllowance', sql.Decimal(12,2), emp.carAllowance || null)
            .input('PetrolAllowance', sql.Decimal(12,2), emp.petrolAllowance || null)
            .input('PhoneAllowance', sql.Decimal(12,2), emp.phoneAllowance || null)
            .input('GrossSalary', sql.Decimal(12,2), emp.grossSalary || null)
            .input('GOSIDeduction', sql.Decimal(12,2), emp.gosiDeduction || null)
            .input('Religion', sql.NVarChar(30), emp.religion || null)
            .input('LastWorkingDate', sql.Date, emp.lastWorkingDate || null)
            .input('PayrollStatus', sql.NVarChar(30), emp.payrollStatus || null)
            .input('AverageSalary', sql.Decimal(12,2), emp.averageSalary || null)
            .input('SerialNo', sql.Int, emp.serialNo || null)
            .input('AccountNumber', sql.NVarChar(50), emp.accountNumber || null)
            .input('PassportExpiryDate', sql.Date, emp.passportExpiryDate || null)
            .input('Email', sql.NVarChar(120), emp.email || null)
            .input('WhatsAppNumber', sql.NVarChar(30), emp.whatsappNumber || null)
            .input('Status', sql.NVarChar(10), emp.status || 'Active')
            .input('ManageOpening', sql.Bit, manageOpening ? 1 : 0)
            .input('OpeningDays', sql.Decimal(10,2), emp.openingDays || 0)
            .input('OpeningBHD', sql.Decimal(10,2), emp.openingBhd || 0)
            .input('CurrentAirfareRate', sql.Decimal(10,2), emp.currentAirfare2024 || 30)
            .input('AirfarePaidDays', sql.Decimal(10,2), emp.airfarePaidDays || 0)
            .input('RemainingBalance', sql.Decimal(10,2), emp.remainingBalance2024 || 0)
            .input('MaximumPayout', sql.Decimal(10,2), emp.maximumPayout || 150)
            .input('TotalAirfare', sql.Decimal(10,2), emp.totalAirfare2024 || 0)
            .input('JanDays', sql.Decimal(5,2), emp.jan || 30)
            .input('FebDays', sql.Decimal(5,2), emp.feb || 30)
            .input('MarDays', sql.Decimal(5,2), emp.mar || 30)
            .input('AprDays', sql.Decimal(5,2), emp.apr || 30)
            .input('MayDays', sql.Decimal(5,2), emp.may || 30)
            .input('JunDays', sql.Decimal(5,2), emp.jun || 30)
            .input('JulDays', sql.Decimal(5,2), emp.jul || 30)
            .input('AugDays', sql.Decimal(5,2), emp.aug || 30)
            .input('SepDays', sql.Decimal(5,2), emp.sep || 30)
            .input('OctDays', sql.Decimal(5,2), emp.oct || 30)
            .input('NovDays', sql.Decimal(5,2), emp.nov || 30)
            .input('DecDays', sql.Decimal(5,2), emp.dec || 30)
            .input('TotalWorkingDays', sql.Decimal(10,2), 
                (emp.jan||0)+(emp.feb||0)+(emp.mar||0)+(emp.apr||0)+(emp.may||0)+(emp.jun||0)+
                (emp.jul||0)+(emp.aug||0)+(emp.sep||0)+(emp.oct||0)+(emp.nov||0)+(emp.dec||0))
            .input('UpdatedBy', sql.Int, req.user.userId)
            .query(`UPDATE Employees SET FullName=@FullName, JoinDate=@JoinDate, CPR=@CPR, Passport=@Passport, Nationality=@Nationality,
                    BHStatus=@BHStatus, Branch=@Branch, Department=@Department, Section=@Section, Location=@Location,
                    Designation=@Designation, EmpGroup=@EmpGroup, BankCode=@BankCode, JobBand=@JobBand, Company=@Company, ReportingTo=@ReportingTo,
                    BasicSalary=@BasicSalary, HRA=@HRA, SpecialDutyAllowance=@SpecialDutyAllowance, CarAllowance=@CarAllowance, PetrolAllowance=@PetrolAllowance,
                    PhoneAllowance=@PhoneAllowance, GrossSalary=@GrossSalary, GOSIDeduction=@GOSIDeduction, Religion=@Religion, LastWorkingDate=@LastWorkingDate,
                    PayrollStatus=@PayrollStatus, AverageSalary=@AverageSalary, SerialNo=@SerialNo, AccountNumber=@AccountNumber, PassportExpiryDate=@PassportExpiryDate,
                    Email=@Email, WhatsAppNumber=@WhatsAppNumber, Status=@Status,
                    OpeningDays=CASE WHEN @ManageOpening = 1 THEN @OpeningDays ELSE OpeningDays END,
                    OpeningBHD=CASE WHEN @ManageOpening = 1 THEN @OpeningBHD ELSE OpeningBHD END,
                    CurrentAirfareRate=@CurrentAirfareRate, AirfarePaidDays=@AirfarePaidDays,
                    RemainingBalance=CASE WHEN @ManageOpening = 1 THEN @RemainingBalance ELSE RemainingBalance END,
                    MaximumPayout=@MaximumPayout,
                    TotalAirfare=CASE WHEN @ManageOpening = 1 THEN @TotalAirfare ELSE TotalAirfare END,
                    JanDays=@JanDays, FebDays=@FebDays, MarDays=@MarDays, AprDays=@AprDays, MayDays=@MayDays, JunDays=@JunDays,
                    JulDays=@JulDays, AugDays=@AugDays, SepDays=@SepDays, OctDays=@OctDays, NovDays=@NovDays, DecDays=@DecDays,
                    TotalWorkingDays=@TotalWorkingDays, UpdatedAt=GETDATE(), UpdatedBy=@UpdatedBy
                    WHERE EmployeeID=@EmployeeID`);

        await logAudit(req.user.userId, req.user.username, 'UPDATE', 'Employee', req.params.id, oldValues, emp, 
            `Updated employee ${oldValues.EmployeeCode}`, req);

        res.json({ message: 'Employee updated' });
    } catch (err) {
        logger.error('Update employee error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/employees/import
app.post('/api/employees/import', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    const { error, value } = Joi.object({
        employees: Joi.array().items(employeePayloadSchema.fork(["code", "name"], (schema) => schema.optional().allow("", null))).min(1).required()
    }).validate(req.body);
    if (error) return res.status(400).json(toApiValidationError(error));
    const rows = value.employees;

    try {
        const db = await getConnection();
        const importRows = rows.map((emp, index) => {
            const totalWorkingDays = Number(emp.totalWorkingDays || 0);
            const monthDays = totalWorkingDays ? totalWorkingDays / 12 : 30;
            return {
                ...emp,
                sourceRow: emp.sourceRow || index + 1,
                jan: emp.jan || monthDays,
                feb: emp.feb || monthDays,
                mar: emp.mar || monthDays,
                apr: emp.apr || monthDays,
                may: emp.may || monthDays,
                jun: emp.jun || monthDays,
                jul: emp.jul || monthDays,
                aug: emp.aug || monthDays,
                sep: emp.sep || monthDays,
                oct: emp.oct || monthDays,
                nov: emp.nov || monthDays,
                dec: emp.dec || monthDays,
                totalWorkingDays: totalWorkingDays || 360
            };
        });

        const result = await db.request()
            .input('EmployeesJson', sql.NVarChar(sql.MAX), JSON.stringify(importRows))
            .input('UserID', sql.Int, req.user.userId)
            .execute('dbo.sp_ATLAS_ImportEmployeeMasterJson');

        const summary = result.recordsets?.[0]?.[0] || {};
        const errors = result.recordsets?.[1] || [];
        const actions = result.recordsets?.[2] || [];
        const inserted = Number(summary.Inserted || 0);
        const updated = Number(summary.Updated || 0);

        await logAudit(req.user.userId, req.user.username, 'IMPORT', 'Employee', null, null,
            { inserted, updated, errors: errors.length }, `Imported ${inserted + updated} employees`, req);

        res.json({
            inserted,
            updated,
            reviewedRows: Number(summary.ReviewedRows || rows.length),
            errors: errors.map((item) => ({
                row: item.SourceRow,
                code: item.EmployeeCode || '',
                error: item.Error || item.ErrorMessage || 'Import row failed'
            })),
            actions: actions.map((item) => ({
                action: item.ActionName,
                code: item.EmployeeCode,
                row: item.SourceRow
            }))
        });
    } catch (err) {
        logger.error('Employee import error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

const employeeImportPreviewSchema = Joi.object({
    fileName: Joi.string().allow("", null).max(260).default("Employee import"),
    headers: Joi.array().items(Joi.string().allow("", null)).default([]),
    employees: Joi.array().items(employeePayloadSchema.fork(["code", "name"], (schema) => schema.optional().allow("", null))).min(1).required()
});

app.post('/api/employees/import-preview', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    const { error, value } = employeeImportPreviewSchema.validate(req.body || {});
    if (error) return res.status(400).json(toApiValidationError(error));

    try {
        const db = await getConnection();
        const result = await db.request()
            .input('FileName', sql.NVarChar(260), value.fileName || 'Employee import')
            .input('HeadersJson', sql.NVarChar(sql.MAX), JSON.stringify(value.headers || []))
            .input('EmployeesJson', sql.NVarChar(sql.MAX), JSON.stringify(value.employees))
            .input('UserID', sql.Int, req.user.userId)
            .execute('dbo.sp_ATLAS_CreateEmployeeImportPreview');

        const batch = result.recordsets?.[0]?.[0] || null;
        const rows = result.recordsets?.[1] || [];
        res.json({
            batch,
            rows: rows.map((row) => ({
                importBatchRowId: Number(row.ImportBatchRowID),
                importBatchId: Number(row.ImportBatchID),
                sourceRow: Number(row.SourceRow),
                code: row.EmployeeCode || '',
                name: row.FullName || '',
                department: row.Department || '',
                designation: row.Designation || '',
                company: row.Company || '',
                status: row.Status,
                action: row.ActionName || '',
                severity: row.Severity,
                message: row.Message,
                selected: Boolean(row.Selected)
            }))
        });
    } catch (err) {
        logger.error('Employee import preview error:', err);
        res.status(500).json({ error: err.message || 'Employee import preview failed' });
    }
});

app.get('/api/employees/import-batches', authenticateToken, requireRole('admin', 'manager', 'hr'), async (_req, res) => {
    try {
        const db = await getConnection();
        const result = await db.request().query('SELECT * FROM dbo.vw_ATLAS_EmployeeImportBatches ORDER BY ImportBatchID DESC');
        res.json(result.recordset);
    } catch (err) {
        logger.error('Employee import batch list error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/employees/import-batches/:id', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    try {
        const db = await getConnection();
        const result = await db.request()
            .input('ImportBatchID', sql.BigInt, req.params.id)
            .execute('dbo.sp_ATLAS_GetEmployeeImportBatch');
        res.json({
            batch: result.recordsets?.[0]?.[0] || null,
            rows: result.recordsets?.[1] || []
        });
    } catch (err) {
        logger.error('Employee import batch view error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/employees/import-confirm', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    const { error, value } = Joi.object({
        importBatchId: Joi.number().integer().min(1).required(),
        rowIds: Joi.array().items(Joi.number().integer().min(1)).min(1).required()
    }).validate(req.body || {});
    if (error) return res.status(400).json(toApiValidationError(error));

    try {
        const db = await getConnection();
        const selectedRowsJson = JSON.stringify(value.rowIds);
        const selectedResult = await db.request()
            .input('ImportBatchID', sql.BigInt, value.importBatchId)
            .input('SelectedRowsJson', sql.NVarChar(sql.MAX), selectedRowsJson)
            .query(`
                DECLARE @Selected TABLE (ImportBatchRowID BIGINT PRIMARY KEY);
                INSERT INTO @Selected (ImportBatchRowID)
                SELECT TRY_CONVERT(BIGINT, value)
                FROM OPENJSON(@SelectedRowsJson)
                WHERE TRY_CONVERT(BIGINT, value) IS NOT NULL;

                UPDATE dbo.EmployeeImportBatchRows
                SET Selected = CASE WHEN s.ImportBatchRowID IS NULL THEN 0 ELSE 1 END
                FROM dbo.EmployeeImportBatchRows r
                LEFT JOIN @Selected s ON s.ImportBatchRowID = r.ImportBatchRowID
                WHERE r.ImportBatchID = @ImportBatchID;

                SELECT ImportBatchRowID, SourceRow, RawJson
                FROM dbo.EmployeeImportBatchRows
                WHERE ImportBatchID = @ImportBatchID
                  AND Selected = 1
                  AND Severity <> 'ERROR'
                ORDER BY SourceRow, ImportBatchRowID;
            `);

        const rawRows = selectedResult.recordset || [];
        if (!rawRows.length) {
            return res.status(400).json({ error: 'No valid selected rows are ready for import.' });
        }

        const importRows = rawRows.map((row) => JSON.parse(row.RawJson));
        const importResult = await db.request()
            .input('EmployeesJson', sql.NVarChar(sql.MAX), JSON.stringify(importRows))
            .input('UserID', sql.Int, req.user.userId)
            .execute('dbo.sp_ATLAS_ImportEmployeeMasterJson');

        const summary = importResult.recordsets?.[0]?.[0] || {};
        const errors = importResult.recordsets?.[1] || [];
        const actions = importResult.recordsets?.[2] || [];
        const inserted = Number(summary.Inserted || 0);
        const updated = Number(summary.Updated || 0);

        await db.request()
            .input('ImportBatchID', sql.BigInt, value.importBatchId)
            .input('InsertedRows', sql.Int, inserted)
            .input('UpdatedRows', sql.Int, updated)
            .input('SelectedRows', sql.Int, rawRows.length)
            .input('ConfirmedBy', sql.Int, req.user.userId)
            .query(`
                UPDATE dbo.EmployeeImportBatches
                SET InsertedRows = @InsertedRows,
                    UpdatedRows = @UpdatedRows,
                    SelectedRows = @SelectedRows,
                    Status = 'IMPORTED',
                    ConfirmedAt = GETDATE(),
                    ConfirmedBy = @ConfirmedBy
                WHERE ImportBatchID = @ImportBatchID;
            `);

        await logAudit(req.user.userId, req.user.username, 'IMPORT_CONFIRM', 'Employee', value.importBatchId, null,
            { inserted, updated, errors: errors.length, selectedRows: rawRows.length }, `Confirmed employee import batch #${value.importBatchId}`, req);

        res.json({
            importBatchId: value.importBatchId,
            inserted,
            updated,
            selectedRows: rawRows.length,
            errors: errors.map((item) => ({
                row: item.SourceRow,
                code: item.EmployeeCode || '',
                error: item.Error || item.ErrorMessage || 'Import row failed'
            })),
            actions: actions.map((item) => ({
                action: item.ActionName,
                code: item.EmployeeCode,
                row: item.SourceRow
            }))
        });
    } catch (err) {
        logger.error('Employee import confirm error:', err);
        res.status(500).json({ error: err.message || 'Employee import confirmation failed' });
    }
});

// DELETE /api/employees/:id
app.delete('/api/employees/:id', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const db = await getConnection();
        const employeeId = parseInt(req.params.id, 10);
        if (!Number.isInteger(employeeId)) return res.status(400).json({ error: 'Invalid employee ID' });
        const forceDelete = String(req.query.force || '').toLowerCase() === 'true';

        const oldResult = await db.request()
            .input('EmployeeID', sql.Int, employeeId)
            .query('SELECT * FROM Employees WHERE EmployeeID = @EmployeeID');
        const oldValues = oldResult.recordset[0];

        if (!oldValues) return res.status(404).json({ error: 'Employee not found' });

        const counts = await db.request()
            .input('EmployeeID', sql.Int, employeeId)
            .query(`
                SELECT
                    (SELECT COUNT(*) FROM Loans WHERE EmployeeID = @EmployeeID) AS Loans,
                    (SELECT COUNT(*) FROM Allocations WHERE EmployeeID = @EmployeeID) AS Allocations,
                    (SELECT COUNT(*) FROM EmergencyTickets WHERE EmployeeID = @EmployeeID) AS EmergencyTickets,
                    (SELECT COUNT(*) FROM OpeningBalances WHERE EmployeeID = @EmployeeID) AS OpeningBalances
            `);
        const { Loans, Allocations, EmergencyTickets, OpeningBalances } = counts.recordset[0] || {};
        const linkedLoans = Number(Loans) || 0;
        const linkedAllocations = Number(Allocations) || 0;
        const linkedTickets = Number(EmergencyTickets) || 0;
        const linkedOpeningBalances = Number(OpeningBalances) || 0;
        const linkedCount = linkedLoans + linkedAllocations + linkedTickets + linkedOpeningBalances;

        if (linkedCount > 0 && !forceDelete) {
            return res.status(409).json({
                code: 'EMPLOYEE_DELETE_BLOCKED',
                error: 'EMPLOYEE_DELETE_BLOCKED: Cannot delete employee because related records exist.',
                message: 'Use ?force=true to remove linked loans, allocations, tickets, and opening balances first.',
                details: {
                    employeeId,
                    loans: linkedLoans,
                    allocations: linkedAllocations,
                    emergencyTickets: linkedTickets,
                    openingBalances: linkedOpeningBalances
                }
            });
        }

        if (forceDelete && linkedCount > 0) {
            const tx = new sql.Transaction(db);
            await tx.begin();
            try {
                const txReq = new sql.Request(tx);
                await txReq
                    .input('EmployeeID', sql.Int, employeeId)
                    .query(`
                        DELETE FROM LoanHistory
                        WHERE LoanID IN (SELECT LoanID FROM Loans WHERE EmployeeID = @EmployeeID);

                        DELETE FROM Loans
                        WHERE EmployeeID = @EmployeeID;

                        DELETE LA
                        FROM dbo.AllocationAttachments LA
                        INNER JOIN dbo.Allocations A ON A.AllocationID = LA.AllocationID
                        WHERE A.EmployeeID = @EmployeeID;

                        DELETE FROM Allocations
                        WHERE EmployeeID = @EmployeeID;

                        DELETE FROM EmergencyTickets
                        WHERE EmployeeID = @EmployeeID;

                        DELETE FROM OpeningBalances
                        WHERE EmployeeID = @EmployeeID;

                        DELETE FROM Employees
                        WHERE EmployeeID = @EmployeeID;
                    `);
                await tx.commit();
            } catch (cascadeErr) {
                try {
                    await tx.rollback();
                } catch (rollbackErr) {
                    logger.warn('Employee forced delete rollback issue:', rollbackErr);
                }
                throw cascadeErr;
            }
        } else {
            await db.request()
                .input('EmployeeID', sql.Int, employeeId)
                .query(`
                    DELETE FROM Employees WHERE EmployeeID = @EmployeeID;
                `);
        }

        await logAudit(req.user.userId, req.user.username, 'DELETE', 'Employee', employeeId, oldValues, null,
            `Deleted employee ${oldValues.EmployeeCode}`, req);

        res.json({ message: 'Employee deleted', deleted: counts.recordset[0] });
    } catch (err) {
        logger.error('Delete employee error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// =====================================================
// ALLOCATION ROUTES
// =====================================================

// GET /api/allocations
app.get('/api/allocations', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const year = req.query.year || new Date().getFullYear();
        const result = await db.request()
            .input('Year', sql.Int, parseInt(year))
            .query(`
                SELECT a.*, e.EmployeeCode, e.FullName
                FROM Allocations a
                JOIN Employees e ON a.EmployeeID = e.EmployeeID
                WHERE a.AllocYear = @Year
                ORDER BY a.AllocationDate DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        logger.error('Get allocations error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/allocations/eligibility-review
app.get('/api/allocations/eligibility-review', authenticateToken, async (req, res) => {
    const employeeId = parseInt(req.query.employeeId, 10);
    const allocYear = parseAllocationYear(req.query.year, req.query.date);
    const allocationDate = req.query.date || new Date().toISOString().slice(0, 10);
    const excludeAllocationId = req.query.excludeAllocationId ? parseInt(req.query.excludeAllocationId, 10) : null;

    if (!Number.isInteger(employeeId) || employeeId <= 0) {
        return res.status(400).json({ error: 'Valid employeeId is required' });
    }

    try {
        const db = await getConnection();
        const result = await db.request()
            .input('EmployeeID', sql.Int, employeeId)
            .input('AllocationDate', sql.Date, allocationDate)
            .input('AllocYear', sql.Int, allocYear)
            .input('ExcludeAllocationID', sql.BigInt, Number.isInteger(excludeAllocationId) ? excludeAllocationId : null)
            .input('CompanyID', sql.Int, req.query.companyId ? parseInt(req.query.companyId, 10) : null)
            .execute('sp_ATLAS_GetAllocationEligibilityReview');

        const review = result.recordset[0] || {};
        const maxPayout = clampAirfareMaximumPayout(review.MaximumPayout);
        review.MaximumPayout = Number(maxPayout.toFixed(2));
        const cappedEntitlement = Math.min(maxPayout, Math.max(0, Number(review.AirfareEntitlementAmount || 0)));
        review.AirfareEntitlementAmount = Number(cappedEntitlement.toFixed(2));
        review.EntitlementApplied = Number(Math.min(cappedEntitlement, Number(review.TicketCost || cappedEntitlement || 0)).toFixed(2));
        res.json(review);
    } catch (err) {
        logger.error('Get allocation eligibility review error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/allocations/:id
app.get('/api/allocations/:id(\\d+)', authenticateToken, async (req, res) => {
    const allocationId = parseInt(req.params.id, 10);
    if (!Number.isInteger(allocationId)) return res.status(400).json({ error: 'Invalid allocation ID' });

    try {
        const db = await getConnection();
        const result = await db.request()
            .input('AllocationID', sql.BigInt, allocationId)
            .query(`
                SELECT a.*, e.EmployeeCode, e.FullName
                FROM Allocations a
                JOIN Employees e ON a.EmployeeID = e.EmployeeID
                WHERE a.AllocationID = @AllocationID
            `);

        if (!result.recordset[0]) {
            return res.status(404).json({ error: 'Allocation not found' });
        }
        res.json(result.recordset[0]);
    } catch (err) {
        logger.error('Get allocation error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/allocations
app.post('/api/allocations', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    const schema = buildAllocationPayloadSchema();
    const { error, value } = schema.validate(req.body, { allowUnknown: true });
    if (error) return res.status(400).json(toApiValidationError(error));

        const alloc = value;
    try {
        const allocYear = parseAllocationYear(alloc.year, alloc.date);
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const tx = new sql.Transaction(db);
        const employee = await db.request()
            .input('EmployeeID', sql.Int, alloc.employeeId)
            .input('AllocYear', sql.Int, allocYear)
            .query(`
                SELECT
                    e.MaximumPayout,
                    e.EmployeeCode,
                    e.FullName,
                    e.JoinDate,
                    e.AirfarePaidDays,
                    COALESCE(ob.OpeningBHD, e.OpeningBHD) AS OpeningBHD,
                    COALESCE(ob.OpeningDays, e.OpeningDays) AS OpeningDays
                FROM Employees e
                LEFT JOIN OpeningBalances ob
                    ON ob.EmployeeID = e.EmployeeID
                   AND ob.BalanceYear = @AllocYear
                WHERE e.EmployeeID = @EmployeeID
                  AND dbo.fn_ATLAS_IsAirfareEligibleEmployeeStatus(e.Status) = 1
            `);
        if (!employee.recordset[0]) return res.status(400).json({ error: 'Employee is not active for airfare allocation. Resigned, separated, probation, and inactive employees are excluded.' });
        const selectedEmployee = employee.recordset[0];
        const effectivePolicy = await getEffectiveAirfarePolicy(db, alloc.date, alloc.companyId || null, alloc.employeeId);
        const allocationContext = await getYearAllocationContext(db, alloc.employeeId, allocYear, null, alloc.date);
        const policyContext = await getPolicyEntitlementFromDb(db, {
            maximumPayout: effectivePolicy.maxPayoutAmount,
            allocationDate: alloc.date,
            allocYear,
            openingDays: selectedEmployee.OpeningDays || 0,
            openingBhd: selectedEmployee.OpeningBHD || 0,
            paidDays: selectedEmployee.AirfarePaidDays || 0,
            currentYearSpending: allocationContext.currentYearSpending,
            joinDate: selectedEmployee.JoinDate,
            previousAllocationDate: allocationContext.previousAllocation?.AllocationDate || null
        });

        const requiresManagerApproval = allocationContext.totalTickets >= 1 || String(alloc.paymentMode || '').toLowerCase() === 'loan';
        if (requiresManagerApproval && !(alloc.managerApproval || '').trim()) {
            return res.status(428).json({
                code: String(alloc.paymentMode || '').toLowerCase() === 'loan' ? 'ALLOCATION_LOAN_MANAGER_APPROVAL' : 'ALLOCATION_SECOND_TICKET_REVIEW',
                error: String(alloc.paymentMode || '').toLowerCase() === 'loan'
                    ? 'Loan ticket requires manager approval before processing.'
                    : 'Second ticket in the same year requires manager approval before processing.',
                employeeCode: selectedEmployee.EmployeeCode,
                employeeName: selectedEmployee.FullName,
                year: allocYear,
                totalTicketsInYear: allocationContext.totalTickets,
                currentYearSpending: Math.round(allocationContext.currentYearSpending * 100) / 100,
                currentYearRemaining: Math.round(policyContext.currentYearRemaining * 100) / 100,
                firstAllocation: allocationContext.firstAllocation
            });
        }
        if (alloc.decision === 'reject') {
            return res.status(409).json({
                code: 'ALLOCATION_REJECTED',
                error: 'Allocation was marked as rejected. No ticket, loan, or payment record was created.'
            });
        }

        const normalizedAllocation = await normalizeAllocationAmountsDb(db, {
            ticketCost: alloc.ticketCost,
            policyEntitlement: policyContext.policyEntitlement,
            maximumPayout: effectivePolicy.maxPayoutAmount,
            paymentMode: alloc.paymentMode || 'entitlement',
            employeePaid: alloc.employeePaid || 0,
            loanAmount: alloc.loanAmount || 0,
            companyExtra: alloc.companyExtra || 0
        });
        const normalizedRemarks = [
            alloc.remarks,
            ((alloc.overrideReason || '').trim() ? `Override Reason: ${alloc.overrideReason}` : ''),
            ((alloc.managerApproval || '').trim() ? `Manager Approval: ${alloc.managerApproval}` : '')
        ]
            .filter(Boolean)
            .join(' | ')
            .slice(0, 255);

        await tx.begin();
        try {
        const result = await new sql.Request(tx)
            .input('EmployeeID', sql.Int, alloc.employeeId)
            .input('AllocationDate', sql.Date, alloc.date)
            .input('AllocYear', sql.Int, allocYear)
            .input('TicketCost', sql.Decimal(10,2), normalizedAllocation.ticketCost)
            .input('Entitlement', sql.Decimal(10,2), normalizedAllocation.entitlement)
            .input('CompanyPaid', sql.Decimal(10,2), normalizedAllocation.companyPaid)
            .input('ExcessAmount', sql.Decimal(10,2), normalizedAllocation.excess)
            .input('PaymentMode', sql.NVarChar(20), alloc.paymentMode || 'entitlement')
            .input('LoanAmount', sql.Decimal(10,2), normalizedAllocation.loanAmount)
            .input('EmployeePaid', sql.Decimal(10,2), normalizedAllocation.employeePaid)
            .input('CompanyExtra', sql.Decimal(10,2), normalizedAllocation.companyExtra)
            .input('EMI', sql.Decimal(10,2), alloc.emi || 0)
            .input('Tenure', sql.Int, alloc.tenure || 0)
            .input('LeaveStart', sql.Date, alloc.leaveStart || null)
            .input('LeaveEnd', sql.Date, alloc.leaveEnd || null)
            .input('Remarks', sql.NVarChar(255), normalizedRemarks || null)
            .input('PolicyRateID', sql.BigInt, effectivePolicy.policyRateId)
            .input('PolicyEffectiveFrom', sql.Date, effectivePolicy.effectiveFrom)
            .input('PolicyMaxPayoutAmount', sql.Decimal(12,2), effectivePolicy.maxPayoutAmount)
            .input('PolicyCycleDays', sql.Decimal(10,2), effectivePolicy.cycleDays)
            .input('PolicyPerDayRate', sql.Decimal(12,6), effectivePolicy.perDayRate)
            .input('CreatedBy', sql.Int, req.user.userId)
            .query(`INSERT INTO Allocations (EmployeeID, AllocationDate, AllocYear, TicketCost, Entitlement, CompanyPaid, ExcessAmount, PaymentMode, LoanAmount, EmployeePaid, CompanyExtra, EMI, Tenure, LeaveStart, LeaveEnd, Remarks, PolicyRateID, PolicyEffectiveFrom, PolicyMaxPayoutAmount, PolicyCycleDays, PolicyPerDayRate, CreatedBy)
                    OUTPUT INSERTED.*
                    VALUES (@EmployeeID, @AllocationDate, @AllocYear, @TicketCost, @Entitlement, @CompanyPaid, @ExcessAmount, @PaymentMode, @LoanAmount, @EmployeePaid, @CompanyExtra, @EMI, @Tenure, @LeaveStart, @LeaveEnd, @Remarks, @PolicyRateID, @PolicyEffectiveFrom, @PolicyMaxPayoutAmount, @PolicyCycleDays, @PolicyPerDayRate, @CreatedBy)`);

        const newAlloc = result.recordset[0];

        // Create loan if applicable
        if (normalizedAllocation.loanAmount > 0) {
            await new sql.Request(tx)
                .input('EmployeeID', sql.Int, alloc.employeeId)
                .input('AllocationID', sql.BigInt, newAlloc.AllocationID)
                .input('OriginalAmount', sql.Decimal(10,2), normalizedAllocation.loanAmount)
                .input('RemainingBalance', sql.Decimal(10,2), normalizedAllocation.loanAmount)
                .input('EMI', sql.Decimal(10,2), alloc.emi)
                .input('Tenure', sql.Int, alloc.tenure)
                .input('CreatedDate', sql.Date, alloc.date)
                .input('CreatedBy', sql.Int, req.user.userId)
                .query(`INSERT INTO Loans (EmployeeID, AllocationID, OriginalAmount, RemainingBalance, EMI, Tenure, CreatedDate, CreatedBy)
                        VALUES (@EmployeeID, @AllocationID, @OriginalAmount, @RemainingBalance, @EMI, @Tenure, @CreatedDate, @CreatedBy)`);
        }

        // Update employee last allocation year
        await new sql.Request(tx)
            .input('EmployeeID', sql.Int, alloc.employeeId)
            .input('LastYear', sql.Int, allocYear)
            .query('UPDATE Employees SET LastAllocationYear = @LastYear WHERE EmployeeID = @EmployeeID');

            await tx.commit();
        await logAudit(req.user.userId, req.user.username, 'CREATE', 'Allocation', newAlloc.AllocationID, null, newAlloc,
            `Created allocation for employee ${alloc.employeeId}`, req);

        res.status(201).json(newAlloc);
        } catch (allocErr) {
            await tx.rollback();
            throw allocErr;
        }
    } catch (err) {
        logger.error('Create allocation error:', err);
        if (err.message && err.message.includes('ALLOCATION')) {
            return res.status(409).json({ code: 'ALLOCATION_ERROR', error: err.message });
        }
        res.status(500).json({ error: err.message || 'Server error' });
    }
});
// PUT /api/allocations/:id
app.put('/api/allocations/:id(\\d+)', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    const schema = buildAllocationPayloadSchema();
    const { error, value } = schema.validate(req.body, { allowUnknown: true });
    if (error) return res.status(400).json(toApiValidationError(error));

    const alloc = value;
    try {
        const allocYear = parseAllocationYear(alloc.year, alloc.date);
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const allocationId = parseInt(req.params.id, 10);
        if (!Number.isInteger(allocationId)) return res.status(400).json({ error: 'Invalid allocation ID' });
        const tx = new sql.Transaction(db);

        const oldResult = await db.request()
            .input('AllocationID', sql.BigInt, allocationId)
            .query('SELECT * FROM Allocations WHERE AllocationID = @AllocationID');
        const oldValues = oldResult.recordset[0];
        if (!oldValues) return res.status(404).json({ error: 'Allocation not found' });

        const employee = await db.request()
            .input('EmployeeID', sql.Int, alloc.employeeId)
            .input('AllocYear', sql.Int, allocYear)
            .query(`
                SELECT
                    e.MaximumPayout,
                    e.JoinDate,
                    e.AirfarePaidDays,
                    COALESCE(ob.OpeningBHD, e.OpeningBHD) AS OpeningBHD,
                    COALESCE(ob.OpeningDays, e.OpeningDays) AS OpeningDays
                FROM Employees e
                LEFT JOIN OpeningBalances ob
                    ON ob.EmployeeID = e.EmployeeID
                   AND ob.BalanceYear = @AllocYear
                WHERE e.EmployeeID = @EmployeeID
                  AND dbo.fn_ATLAS_IsAirfareEligibleEmployeeStatus(e.Status) = 1
            `);
        if (!employee.recordset[0]) return res.status(400).json({ error: 'Employee is not active for airfare allocation. Resigned, separated, probation, and inactive employees are excluded.' });
        const effectivePolicy = await getEffectiveAirfarePolicy(db, alloc.date, alloc.companyId || null, alloc.employeeId);
        const employeeMaximumPayout = effectivePolicy.maxPayoutAmount;

        const allocationContext = await getYearAllocationContext(db, alloc.employeeId, allocYear, allocationId, alloc.date);
        const policyContext = await getPolicyEntitlementFromDb(db, {
            maximumPayout: employeeMaximumPayout,
            allocationDate: alloc.date,
            allocYear,
            openingDays: employee.recordset[0].OpeningDays || 0,
            openingBhd: employee.recordset[0].OpeningBHD || 0,
            paidDays: employee.recordset[0].AirfarePaidDays || 0,
            currentYearSpending: allocationContext.currentYearSpending,
            joinDate: employee.recordset[0].JoinDate,
            previousAllocationDate: allocationContext.previousAllocation?.AllocationDate || null
        });
        const requiresManagerApproval = allocationContext.totalTickets >= 1 || String(alloc.paymentMode || '').toLowerCase() === 'loan';
        if (requiresManagerApproval && !(alloc.managerApproval || '').trim()) {
            return res.status(428).json({
                code: String(alloc.paymentMode || '').toLowerCase() === 'loan' ? 'ALLOCATION_LOAN_MANAGER_APPROVAL' : 'ALLOCATION_SECOND_TICKET_REVIEW',
                error: String(alloc.paymentMode || '').toLowerCase() === 'loan'
                    ? 'Loan ticket requires manager approval before processing.'
                    : 'Second ticket in the same year requires manager approval before processing.',
                employeeCode: 'N/A',
                employeeName: 'N/A',
                year: allocYear,
                totalTicketsInYear: allocationContext.totalTickets,
                currentYearSpending: Math.round(allocationContext.currentYearSpending * 100) / 100,
                currentYearRemaining: Math.round(policyContext.currentYearRemaining * 100) / 100,
                firstAllocation: allocationContext.firstAllocation
            });
        }
        if (alloc.decision === 'reject') {
            return res.status(409).json({
                code: 'ALLOCATION_REJECTED',
                error: 'Allocation was marked as rejected. No ticket, loan, or payment changes were applied.'
            });
        }

        const normalizedAllocation = await normalizeAllocationAmountsDb(db, {
            ticketCost: alloc.ticketCost,
            policyEntitlement: policyContext.policyEntitlement,
            maximumPayout: effectivePolicy.maxPayoutAmount,
            paymentMode: alloc.paymentMode || 'entitlement',
            employeePaid: alloc.employeePaid || 0,
            loanAmount: alloc.loanAmount || 0,
            companyExtra: alloc.companyExtra || 0
        });
        const normalizedRemarks = [
            alloc.remarks,
            ((alloc.overrideReason || '').trim() ? `Override Reason: ${alloc.overrideReason}` : ''),
            ((alloc.managerApproval || '').trim() ? `Manager Approval: ${alloc.managerApproval}` : '')
        ]
            .filter(Boolean)
            .join(' | ')
            .slice(0, 255);

        await tx.begin();
        try {
        const result = await new sql.Request(tx)
            .input('AllocationID', sql.BigInt, allocationId)
            .input('EmployeeID', sql.Int, alloc.employeeId)
            .input('AllocationDate', sql.Date, alloc.date)
            .input('AllocYear', sql.Int, allocYear)
            .input('TicketCost', sql.Decimal(10,2), normalizedAllocation.ticketCost)
            .input('Entitlement', sql.Decimal(10,2), normalizedAllocation.entitlement)
            .input('CompanyPaid', sql.Decimal(10,2), normalizedAllocation.companyPaid)
            .input('ExcessAmount', sql.Decimal(10,2), normalizedAllocation.excess)
            .input('PaymentMode', sql.NVarChar(20), alloc.paymentMode || 'entitlement')
            .input('LoanAmount', sql.Decimal(10,2), normalizedAllocation.loanAmount)
            .input('EmployeePaid', sql.Decimal(10,2), normalizedAllocation.employeePaid)
            .input('CompanyExtra', sql.Decimal(10,2), normalizedAllocation.companyExtra)
            .input('EMI', sql.Decimal(10,2), alloc.emi || 0)
            .input('Tenure', sql.Int, alloc.tenure || 0)
            .input('LeaveStart', sql.Date, alloc.leaveStart || null)
            .input('LeaveEnd', sql.Date, alloc.leaveEnd || null)
            .input('Remarks', sql.NVarChar(255), normalizedRemarks || null)
            .input('PolicyRateID', sql.BigInt, effectivePolicy.policyRateId)
            .input('PolicyEffectiveFrom', sql.Date, effectivePolicy.effectiveFrom)
            .input('PolicyMaxPayoutAmount', sql.Decimal(12,2), effectivePolicy.maxPayoutAmount)
            .input('PolicyCycleDays', sql.Decimal(10,2), effectivePolicy.cycleDays)
            .input('PolicyPerDayRate', sql.Decimal(12,6), effectivePolicy.perDayRate)
            .query(`UPDATE Allocations SET
                    EmployeeID = @EmployeeID,
                    AllocationDate = @AllocationDate,
                    AllocYear = @AllocYear,
                    TicketCost = @TicketCost,
                    Entitlement = @Entitlement,
                    CompanyPaid = @CompanyPaid,
                    ExcessAmount = @ExcessAmount,
                    PaymentMode = @PaymentMode,
                    LoanAmount = @LoanAmount,
                    EmployeePaid = @EmployeePaid,
                    CompanyExtra = @CompanyExtra,
                    EMI = @EMI,
                    Tenure = @Tenure,
                    LeaveStart = @LeaveStart,
                    LeaveEnd = @LeaveEnd,
                    Remarks = @Remarks,
                    PolicyRateID = @PolicyRateID,
                    PolicyEffectiveFrom = @PolicyEffectiveFrom,
                    PolicyMaxPayoutAmount = @PolicyMaxPayoutAmount,
                    PolicyCycleDays = @PolicyCycleDays,
                    PolicyPerDayRate = @PolicyPerDayRate
                    OUTPUT INSERTED.*
                    WHERE AllocationID = @AllocationID`);

        const updatedAlloc = result.recordset[0];

        await new sql.Request(tx)
            .input('AllocationID', sql.BigInt, allocationId)
            .query(`
                DELETE FROM LoanHistory WHERE LoanID IN (SELECT LoanID FROM Loans WHERE AllocationID = @AllocationID);
                DELETE FROM Loans WHERE AllocationID = @AllocationID;
            `);

        if (normalizedAllocation.loanAmount > 0) {
            await new sql.Request(tx)
                .input('EmployeeID', sql.Int, alloc.employeeId)
                .input('AllocationID', sql.BigInt, allocationId)
                .input('OriginalAmount', sql.Decimal(10,2), normalizedAllocation.loanAmount)
                .input('RemainingBalance', sql.Decimal(10,2), normalizedAllocation.loanAmount)
                .input('EMI', sql.Decimal(10,2), alloc.emi)
                .input('Tenure', sql.Int, alloc.tenure)
                .input('CreatedDate', sql.Date, alloc.date)
                .input('CreatedBy', sql.Int, req.user.userId)
                .query(`INSERT INTO Loans (EmployeeID, AllocationID, OriginalAmount, RemainingBalance, EMI, Tenure, CreatedDate, CreatedBy)
                        VALUES (@EmployeeID, @AllocationID, @OriginalAmount, @RemainingBalance, @EMI, @Tenure, @CreatedDate, @CreatedBy)`);
        }

        await new sql.Request(tx)
            .input('EmployeeID', sql.Int, alloc.employeeId)
            .input('LastYear', sql.Int, allocYear)
            .query('UPDATE Employees SET LastAllocationYear = @LastYear WHERE EmployeeID = @EmployeeID');
        await tx.commit();

        await logAudit(req.user.userId, req.user.username, 'UPDATE', 'Allocation', allocationId, oldValues, updatedAlloc,
            `Updated allocation #${allocationId}`, req);

        res.json(updatedAlloc);
        } catch (allocErr) {
            await tx.rollback();
            throw allocErr;
        }
    } catch (err) {
        logger.error('Update allocation error:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
});
// GET /api/allocations/attachments?ids=1,2,3
app.get('/api/allocations/attachments', authenticateToken, async (req, res) => {
    try {
        const rawIds = String(req.query.ids || "")
            .split(",")
            .map((value) => Number(String(value).trim()))
            .filter((value) => Number.isInteger(value) && value > 0);

        if (rawIds.length === 0) {
            return res.json([]);
        }

        const uniqueIds = Array.from(new Set(rawIds)).slice(0, 1000);
        const request = await getConnection().then((db) => db.request());
        const placeholders = uniqueIds.map((_, index) => `@AllocationID${index}`).join(",");
        uniqueIds.forEach((allocationId, index) => {
            request.input(`AllocationID${index}`, sql.BigInt, allocationId);
        });

        const result = await request.query(`
            SELECT AttachmentID, AllocationID, FileName, MimeType, FileSize, CreatedAt
            FROM AllocationAttachments
            WHERE AllocationID IN (${placeholders})
            ORDER BY AllocationID, AttachmentID
        `);

        res.json(result.recordset);
    } catch (err) {
        logger.error('Get allocations attachments list error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/allocations/:id/attachments
app.get('/api/allocations/:id(\\d+)/attachments', authenticateToken, async (req, res) => {
    try {
        const allocationId = parseInt(req.params.id, 10);
        if (!Number.isInteger(allocationId)) return res.status(400).json({ error: 'Invalid allocation ID' });

        const db = await getConnection();
        const result = await db.request()
            .input('AllocationID', sql.BigInt, allocationId)
            .query('EXEC dbo.sp_ATLAS_GetAllocationAttachments @AllocationID');
        res.json(result.recordset);
    } catch (err) {
        logger.error('Get allocation attachments error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/allocation-attachments/:id/view
app.get('/api/allocation-attachments/:id/view', authenticateToken, async (req, res) => {
    try {
        const attachmentId = parseInt(req.params.id, 10);
        if (!Number.isInteger(attachmentId)) return res.status(400).json({ error: 'Invalid attachment ID' });

        const db = await getConnection();
        const result = await db.request()
            .input('AttachmentID', sql.BigInt, attachmentId)
            .query('SELECT FileName, MimeType, AttachmentData FROM AllocationAttachments WHERE AttachmentID = @AttachmentID');
        const attachment = result.recordset[0];
        if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

        res.setHeader('Content-Type', attachment.MimeType);
        res.setHeader('Content-Disposition', `inline; filename="${String(attachment.FileName).replace(/"/g, '')}"`);
        res.send(Buffer.from(attachment.AttachmentData));
    } catch (err) {
        logger.error('View allocation attachment error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/allocations/:id/attachments
app.post('/api/allocations/:id(\\d+)/attachments', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    const schema = Joi.object({
        fileName: Joi.string().max(255).required(),
        mimeType: Joi.string().valid('application/pdf', 'image/png', 'image/jpeg', 'image/webp').required(),
        dataBase64: Joi.string().required()
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
        const allocationId = parseInt(req.params.id, 10);
        if (!Number.isInteger(allocationId)) return res.status(400).json({ error: 'Invalid allocation ID' });

        const cleanBase64 = value.dataBase64.includes(',') ? value.dataBase64.split(',').pop() : value.dataBase64;
        const buffer = Buffer.from(cleanBase64, 'base64');
        if (!buffer.length) return res.status(400).json({ error: 'Attachment file is empty' });
        if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Attachment must be 5 MB or smaller' });

        const db = await getConnection();
        const result = await db.request()
            .input('AllocationID', sql.BigInt, allocationId)
            .input('FileName', sql.NVarChar(255), value.fileName)
            .input('MimeType', sql.NVarChar(100), value.mimeType)
            .input('FileSize', sql.Int, buffer.length)
            .input('AttachmentData', sql.VarBinary(sql.MAX), buffer)
            .input('CreatedBy', sql.Int, req.user.userId)
            .query('EXEC dbo.sp_ATLAS_AddAllocationAttachment @AllocationID, @FileName, @MimeType, @FileSize, @AttachmentData, @CreatedBy');

        const attachment = result.recordset[0];
        await logAudit(req.user.userId, req.user.username, 'CREATE', 'Allocation', allocationId, null, attachment, `Uploaded allocation attachment ${attachment.FileName}`, req);
        res.status(201).json(attachment);
    } catch (err) {
        logger.error('Upload allocation attachment error:', err);
        res.status(500).json({ error: err.originalError?.info?.message || err.message || 'Server error' });
    }
});

// =====================================================
// DELETE /api/allocations/:id
app.delete('/api/allocations/:id(\\d+)', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    try {
        const db = await getConnection();
        const allocationId = parseInt(req.params.id, 10);
        if (!Number.isInteger(allocationId)) return res.status(400).json({ error: 'Invalid allocation ID' });
        const tx = new sql.Transaction(db);

        const oldResult = await db.request()
            .input('AllocationID', sql.BigInt, allocationId)
            .query('SELECT * FROM Allocations WHERE AllocationID = @AllocationID');
        const oldValues = oldResult.recordset[0];
        if (!oldValues) return res.status(404).json({ error: 'Allocation not found' });

        await tx.begin();
        try {
            await new sql.Request(tx)
                .input('AllocationID', sql.BigInt, allocationId)
                .query(`
                    DELETE FROM LoanHistory WHERE LoanID IN (SELECT LoanID FROM Loans WHERE AllocationID = @AllocationID);
                    DELETE FROM Loans WHERE AllocationID = @AllocationID;
                    DELETE FROM AllocationAttachments WHERE AllocationID = @AllocationID;
                    DELETE FROM Allocations WHERE AllocationID = @AllocationID;
                `);
            await tx.commit();
        } catch (deleteErr) {
            await tx.rollback();
            throw deleteErr;
        }

        await logAudit(req.user.userId, req.user.username, 'DELETE', 'Allocation', allocationId, oldValues, null,
            `Deleted allocation #${allocationId}`, req);

        res.json({ message: 'Allocation deleted' });
    } catch (err) {
        logger.error('Delete allocation error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});
// LOAN ROUTES
// =====================================================

// GET /api/loans/active
app.get('/api/loans/active', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const result = await db.request()
            .input('Status', sql.NVarChar(15), 'active')
            .query('EXEC dbo.sp_ATLAS_GetLoanRegister @Status');
        res.json(result.recordset);
    } catch (err) {
        logger.error('Get loans error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/loans/register
app.get('/api/loans/register', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const status = req.query.status || null;
        const result = await db.request()
            .input('Status', sql.NVarChar(15), status)
            .query('EXEC dbo.sp_ATLAS_GetLoanRegister @Status');
        res.json(result.recordset);
    } catch (err) {
        logger.error('Get loan register error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/loans/summary
app.get('/api/loans/summary', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const result = await db.request().query('EXEC dbo.sp_ATLAS_GetLoanSummary');
        res.json(result.recordset[0]);
    } catch (err) {
        logger.error('Get loan summary error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/loans/:id
app.get('/api/loans/:id', authenticateToken, async (req, res) => {
    try {
        const loanId = parseInt(req.params.id, 10);
    if (!Number.isInteger(loanId)) {
        return res.status(400).json({ error: 'Invalid loan ID' });
    }

    const db = await getConnection();
    const result = await db.request()
        .input('LoanID', sql.BigInt, loanId)
        .query('SELECT TOP 1 * FROM dbo.vw_ATLAS_LoanRegister WHERE LoanID = @LoanID');

        const loan = result.recordset[0];
        if (!loan) return res.status(404).json({ error: 'Loan not found' });

        res.json(loan);
    } catch (err) {
        logger.error('Get loan error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/loans/:id/history
app.get('/api/loans/:id/history', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const loanId = parseInt(req.params.id, 10);
        if (!Number.isInteger(loanId)) return res.status(400).json({ error: 'Invalid loan ID' });
        const result = await db.request()
            .input('LoanID', sql.BigInt, loanId)
            .query(`SELECT * FROM LoanHistory WHERE LoanID = @LoanID ORDER BY PaymentDate DESC, HistoryID DESC`);
        res.json(result.recordset);
    } catch (err) {
        logger.error('Get loan history error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/loans
app.post('/api/loans', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    const schema = Joi.object({
        employeeId: Joi.number().integer().required(),
        amount: Joi.number().positive().required(),
        tenure: Joi.number().integer().min(1).max(240).required(),
        date: Joi.date().required(),
        note: Joi.string().allow('', null).max(255)
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
        const db = await getConnection();
        const result = await db.request()
            .input('EmployeeID', sql.Int, value.employeeId)
            .input('OriginalAmount', sql.Decimal(12, 2), value.amount)
            .input('Tenure', sql.Int, value.tenure)
            .input('CreatedDate', sql.Date, value.date)
            .input('Note', sql.NVarChar(255), value.note || 'Manual employee loan')
            .input('CreatedBy', sql.Int, req.user.userId)
            .query('EXEC dbo.sp_ATLAS_CreateManualLoan @EmployeeID, @OriginalAmount, @Tenure, @CreatedDate, @Note, @CreatedBy');

        const loan = result.recordset[0];
        await logAudit(req.user.userId, req.user.username, 'CREATE', 'Loan', loan.LoanID, null, loan, `Created manual loan #${loan.LoanID}`, req);
        res.status(201).json(loan);
    } catch (err) {
        logger.error('Create loan error:', err);
        res.status(500).json({ error: err.originalError?.info?.message || err.message || 'Server error' });
    }
});

// PUT /api/loans/:id
app.put('/api/loans/:id', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    const schema = Joi.object({
        employeeId: Joi.number().integer().required(),
        amount: Joi.number().positive().required(),
        tenure: Joi.number().integer().min(1).max(240).required(),
        date: Joi.date().required(),
        note: Joi.string().allow('', null).max(255)
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
        const db = await getConnection();
        const loanId = parseInt(req.params.id, 10);
        if (!Number.isInteger(loanId)) return res.status(400).json({ error: 'Invalid loan ID' });

        const oldResult = await db.request()
            .input('LoanID', sql.BigInt, loanId)
            .query('SELECT * FROM Loans WHERE LoanID = @LoanID');
        const oldLoan = oldResult.recordset[0];
        if (!oldLoan) return res.status(404).json({ error: 'Loan not found' });
        if (oldLoan.Status && oldLoan.Status !== 'active') return res.status(400).json({ error: 'Only active loans can be edited' });

        const emi = Math.round((Number(value.amount) / Number(value.tenure)) * 100) / 100;
        const result = await db.request()
            .input('LoanID', sql.BigInt, loanId)
            .input('EmployeeID', sql.Int, value.employeeId)
            .input('OriginalAmount', sql.Decimal(12, 2), value.amount)
            .input('RemainingBalance', sql.Decimal(12, 2), value.amount)
            .input('EMI', sql.Decimal(12, 2), emi)
            .input('Tenure', sql.Int, value.tenure)
            .input('CreatedDate', sql.Date, value.date)
            .query(`UPDATE Loans SET
                    EmployeeID = @EmployeeID,
                    OriginalAmount = @OriginalAmount,
                    RemainingBalance = @RemainingBalance,
                    EMI = @EMI,
                    Tenure = @Tenure,
                    MonthsPaid = 0,
                    TotalPaid = 0,
                    CreatedDate = @CreatedDate,
                    SettledDate = NULL,
                    Status = 'active'
                    OUTPUT INSERTED.*
                    WHERE LoanID = @LoanID`);

        const updatedLoan = result.recordset[0];
        await db.request()
            .input('LoanID', sql.BigInt, loanId)
            .query('DELETE FROM LoanHistory WHERE LoanID = @LoanID');

        await logAudit(req.user.userId, req.user.username, 'UPDATE', 'Loan', loanId, oldLoan, updatedLoan,
            `Updated loan #${loanId}`, req);
        res.json(updatedLoan);
    } catch (err) {
        logger.error('Update loan error:', err);
        res.status(500).json({ error: err.originalError?.info?.message || err.message || 'Server error' });
    }
});

// POST /api/loans/run-emis/preview
app.post('/api/loans/run-emis/preview', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const schema = Joi.object({
        loanIds: Joi.array().items(Joi.number().integer().min(1)).default([]),
        paymentDate: Joi.date().default(() => new Date())
    });
    const { error, value } = schema.validate(req.body || {});
    if (error) return res.status(400).json(toApiValidationError(error));

    try {
        const db = await getConnection();
        const loanIdsCsv = toLoanIdsCsv(value.loanIds);
        const result = await db.request()
            .input('LoanIDsCsv', sql.NVarChar(sql.MAX), loanIdsCsv)
            .query(`
                DECLARE @Selected TABLE (LoanID BIGINT PRIMARY KEY);
                IF NULLIF(LTRIM(RTRIM(@LoanIDsCsv)), '') IS NOT NULL
                BEGIN
                    INSERT INTO @Selected (LoanID)
                    SELECT DISTINCT TRY_CONVERT(BIGINT, value)
                    FROM STRING_SPLIT(@LoanIDsCsv, ',')
                    WHERE TRY_CONVERT(BIGINT, value) IS NOT NULL;
                END;

                SELECT
                    LoanID,
                    EmployeeCode,
                    FullName,
                    RemainingBalance,
                    EMI,
                    CASE WHEN EMI < RemainingBalance THEN EMI ELSE RemainingBalance END AS NextDeduction,
                    RemainingBalance - CASE WHEN EMI < RemainingBalance THEN EMI ELSE RemainingBalance END AS BalanceAfter
                FROM dbo.vw_ATLAS_LoanRegister
                WHERE Status = 'active'
                  AND RemainingBalance > 0
                  AND (NOT EXISTS (SELECT 1 FROM @Selected) OR LoanID IN (SELECT LoanID FROM @Selected))
                ORDER BY FullName, LoanID;
            `);
        const rows = result.recordset;
        res.json({
            paymentDate: value.paymentDate,
            selected: loanIdsCsv ? rows.length : 'all-active',
            processed: rows.length,
            totalDeducted: rows.reduce((sum, row) => sum + Number(row.NextDeduction || 0), 0),
            rows
        });
    } catch (err) {
        logger.error('Preview EMIs error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/loans/run-emis
app.post('/api/loans/run-emis', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const schema = Joi.object({
        loanIds: Joi.array().items(Joi.number().integer().min(1)).default([]),
        paymentDate: Joi.date().default(() => new Date()),
        confirm: Joi.string().valid('RUN_EMI').required()
    });
    const { error, value } = schema.validate(req.body || {});
    if (error) return res.status(428).json(toApiValidationError(error));

    try {
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const loanIdsCsv = toLoanIdsCsv(value.loanIds);
        const result = await db.request()
            .input('PaymentDate', sql.Date, value.paymentDate)
            .input('CreatedBy', sql.Int, req.user.userId)
            .input('LoanIDsCsv', sql.NVarChar(sql.MAX), loanIdsCsv)
            .query('EXEC dbo.sp_ATLAS_RunMonthlyLoanEMI @PaymentDate, @CreatedBy, @LoanIDsCsv');
        const summary = result.recordset[0] || { Processed: 0, TotalDeducted: 0 };

        await logAudit(req.user.userId, req.user.username, 'LOAN_EMI', 'Loan', null, null, 
            { ...summary, loanIds: value.loanIds }, `Ran EMIs for ${summary.Processed} loans`, req);

        res.json({ processed: summary.Processed, totalDeducted: Number(summary.TotalDeducted || 0).toFixed(2) });
    } catch (err) {
        logger.error('Run EMIs error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/loans/reverse-emis/preview
app.post('/api/loans/reverse-emis/preview', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const schema = Joi.object({
        loanIds: Joi.array().items(Joi.number().integer().min(1)).min(1).required()
    });
    const { error, value } = schema.validate(req.body || {});
    if (error) return res.status(400).json(toApiValidationError(error));

    try {
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const loanIdsCsv = toLoanIdsCsv(value.loanIds);
        const result = await db.request()
            .input('LoanIDsCsv', sql.NVarChar(sql.MAX), loanIdsCsv)
            .query(`
                DECLARE @Selected TABLE (LoanID BIGINT PRIMARY KEY);
                INSERT INTO @Selected (LoanID)
                SELECT DISTINCT TRY_CONVERT(BIGINT, value)
                FROM STRING_SPLIT(@LoanIDsCsv, ',')
                WHERE TRY_CONVERT(BIGINT, value) IS NOT NULL;

                WITH LatestHistory AS (
                    SELECT
                        lh.*,
                        ROW_NUMBER() OVER (PARTITION BY lh.LoanID ORDER BY lh.PaymentDate DESC, lh.HistoryID DESC) AS rn
                    FROM LoanHistory lh
                    JOIN @Selected s ON s.LoanID = lh.LoanID
                )
                SELECT
                    l.LoanID,
                    r.EmployeeCode,
                    r.FullName,
                    l.Status,
                    l.RemainingBalance,
                    l.TotalPaid,
                    l.MonthsPaid,
                    lh.HistoryID,
                    lh.PaymentDate,
                    lh.Amount AS AmountToReturn,
                    CAST(l.RemainingBalance + lh.Amount AS DECIMAL(12,2)) AS BalanceAfterReturn,
                    CAST(CASE WHEN l.TotalPaid - lh.Amount > 0 THEN l.TotalPaid - lh.Amount ELSE 0 END AS DECIMAL(12,2)) AS TotalPaidAfterReturn,
                    CASE
                        WHEN lh.HistoryID IS NULL THEN 'No loan history found.'
                        WHEN lh.PaymentType <> 'emi' THEN CONCAT('Latest loan history is ', lh.PaymentType, ', not EMI.')
                        WHEN lh.Amount <= 0 THEN 'Latest EMI amount is not valid for return.'
                        ELSE 'Ready'
                    END AS ReturnStatus
                FROM @Selected s
                JOIN Loans l ON l.LoanID = s.LoanID
                JOIN dbo.vw_ATLAS_LoanRegister r ON r.LoanID = l.LoanID
                OUTER APPLY (SELECT TOP 1 * FROM LatestHistory h WHERE h.LoanID = l.LoanID AND h.rn = 1) lh
                ORDER BY r.FullName, l.LoanID;
            `);
        const rows = result.recordset;
        const reversibleRows = rows.filter((row) => row.ReturnStatus === 'Ready');
        res.json({
            selected: rows.length,
            reversible: reversibleRows.length,
            totalReturned: reversibleRows.reduce((sum, row) => sum + Number(row.AmountToReturn || 0), 0),
            rows
        });
    } catch (err) {
        logger.error('Preview EMI reversal error:', err);
        res.status(500).json({ error: err.originalError?.info?.message || err.message || 'Server error' });
    }
});

// POST /api/loans/reverse-emis
app.post('/api/loans/reverse-emis', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const schema = Joi.object({
        loanIds: Joi.array().items(Joi.number().integer().min(1)).min(1).required(),
        reversalDate: Joi.date().default(() => new Date()),
        note: Joi.string().allow('', null).max(255),
        confirm: Joi.string().valid('REVERSE_EMI').required()
    });
    const { error, value } = schema.validate(req.body || {});
    if (error) return res.status(428).json(toApiValidationError(error));

    const db = await getConnection();
    await ensureAtlasSqlObjects(db);
    const tx = new sql.Transaction(db);
    try {
        const loanIdsCsv = toLoanIdsCsv(value.loanIds);
        await tx.begin();
        const preview = await new sql.Request(tx)
            .input('LoanIDsCsv', sql.NVarChar(sql.MAX), loanIdsCsv)
            .query(`
                DECLARE @Selected TABLE (LoanID BIGINT PRIMARY KEY);
                INSERT INTO @Selected (LoanID)
                SELECT DISTINCT TRY_CONVERT(BIGINT, value)
                FROM STRING_SPLIT(@LoanIDsCsv, ',')
                WHERE TRY_CONVERT(BIGINT, value) IS NOT NULL;

                WITH LatestHistory AS (
                    SELECT
                        lh.*,
                        ROW_NUMBER() OVER (PARTITION BY lh.LoanID ORDER BY lh.PaymentDate DESC, lh.HistoryID DESC) AS rn
                    FROM LoanHistory lh WITH (UPDLOCK, HOLDLOCK)
                    JOIN @Selected s ON s.LoanID = lh.LoanID
                )
                SELECT
                    l.LoanID,
                    l.Status,
                    l.RemainingBalance,
                    l.TotalPaid,
                    l.MonthsPaid,
                    lh.HistoryID,
                    lh.Amount AS AmountToReturn
                FROM @Selected s
                JOIN Loans l WITH (UPDLOCK, HOLDLOCK) ON l.LoanID = s.LoanID
                JOIN LatestHistory lh ON lh.LoanID = l.LoanID AND lh.rn = 1
                WHERE lh.PaymentType = 'emi'
                  AND lh.Amount > 0;
            `);

        if (!preview.recordset.length) {
            await tx.rollback();
            return res.status(409).json({ error: 'No selected loan has a latest EMI entry available for return.' });
        }

        const processed = [];
        for (const row of preview.recordset) {
            const amount = Number(row.AmountToReturn || 0);
            const newBalance = Number(row.RemainingBalance || 0) + amount;
            const newTotalPaid = Math.max(0, Number(row.TotalPaid || 0) - amount);
            const newMonthsPaid = Math.max(0, Number(row.MonthsPaid || 0) - 1);
            await new sql.Request(tx)
                .input('LoanID', sql.BigInt, row.LoanID)
                .input('RemainingBalance', sql.Decimal(12, 2), newBalance)
                .input('TotalPaid', sql.Decimal(12, 2), newTotalPaid)
                .input('MonthsPaid', sql.Int, newMonthsPaid)
                .query(`
                    UPDATE Loans
                    SET RemainingBalance = @RemainingBalance,
                        TotalPaid = @TotalPaid,
                        MonthsPaid = @MonthsPaid,
                        Status = 'active',
                        SettledDate = NULL
                    WHERE LoanID = @LoanID;
                `);
            await new sql.Request(tx)
                .input('LoanID', sql.BigInt, row.LoanID)
                .input('PaymentDate', sql.Date, value.reversalDate)
                .input('Amount', sql.Decimal(12, 2), amount)
                .input('BalanceAfter', sql.Decimal(12, 2), newBalance)
                .input('Note', sql.NVarChar(255), value.note || `Returned EMI history #${row.HistoryID}`)
                .input('CreatedBy', sql.Int, req.user.userId)
                .query(`
                    INSERT INTO LoanHistory (LoanID, PaymentDate, PaymentType, Amount, BalanceAfter, Note, CreatedBy)
                    VALUES (@LoanID, @PaymentDate, 'reversal', @Amount, @BalanceAfter, @Note, @CreatedBy);
                `);
            processed.push({ loanId: row.LoanID, amountReturned: amount, balanceAfter: newBalance });
        }

        await tx.commit();
        const totalReturned = processed.reduce((sum, row) => sum + row.amountReturned, 0);
        await logAudit(req.user.userId, req.user.username, 'LOAN_EMI_REVERSAL', 'Loan', null, null,
            { processed: processed.length, totalReturned, loans: processed }, `Returned EMIs for ${processed.length} loan(s)`, req);
        res.json({ processed: processed.length, totalReturned: Number(totalReturned.toFixed(2)), loans: processed });
    } catch (err) {
        try {
            if (tx._aborted !== true) await tx.rollback();
        } catch {}
        logger.error('Reverse EMI error:', err);
        res.status(500).json({ error: err.originalError?.info?.message || err.message || 'Server error' });
    }
});

// POST /api/loans/:id/settle
app.post('/api/loans/:id/settle', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const schema = Joi.object({
        settlementDate: Joi.date().default(() => new Date()),
        note: Joi.string().allow('', null).max(255),
        confirm: Joi.string().valid('SETTLE').required()
    });
    const { error, value } = schema.validate(req.body || {});
    if (error) return res.status(428).json(toApiValidationError(error));

    try {
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const result = await db.request()
            .input('LoanID', sql.BigInt, req.params.id)
            .query('SELECT * FROM Loans WHERE LoanID = @LoanID');

        const loan = result.recordset[0];
        if (!loan) return res.status(404).json({ error: 'Loan not found' });

        const oldValues = { ...loan };
        const settled = await db.request()
            .input('LoanID', sql.BigInt, req.params.id)
            .input('PaymentDate', sql.Date, value.settlementDate)
            .input('Note', sql.NVarChar(255), value.note || 'Early payoff / closure')
            .input('CreatedBy', sql.Int, req.user.userId)
            .query('EXEC dbo.sp_ATLAS_SettleLoan @LoanID, @PaymentDate, @CreatedBy, @Note');

        await logAudit(req.user.userId, req.user.username, 'LOAN_SETTLE', 'Loan', req.params.id, oldValues, 
            settled.recordset[0], `Settled loan #${req.params.id}`, req);

        res.json({ message: 'Loan settled', loan: settled.recordset[0] });
    } catch (err) {
        logger.error('Settle loan error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// =====================================================
// DELETE /api/loans/:id
app.delete('/api/loans/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    try {
        const db = await getConnection();
        const loanId = parseInt(req.params.id, 10);
        if (!Number.isInteger(loanId)) return res.status(400).json({ error: 'Invalid loan ID' });

        const oldResult = await db.request()
            .input('LoanID', sql.BigInt, loanId)
            .query('SELECT * FROM Loans WHERE LoanID = @LoanID');
        const oldValues = oldResult.recordset[0];
        if (!oldValues) return res.status(404).json({ error: 'Loan not found' });

        await db.request()
            .input('LoanID', sql.BigInt, loanId)
            .query(`
                DELETE FROM LoanHistory WHERE LoanID = @LoanID;
                DELETE FROM Loans WHERE LoanID = @LoanID;
            `);

        await logAudit(req.user.userId, req.user.username, 'DELETE', 'Loan', loanId, oldValues, null,
            `Deleted loan #${loanId}`, req);

        res.json({ message: 'Loan deleted' });
    } catch (err) {
        logger.error('Delete loan error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/loans/settle-all
app.post('/api/loans/settle-all', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    try {
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const result = await db.request().query(`
            SELECT LoanID, RemainingBalance, TotalPaid
            FROM Loans WHERE Status = 'active'
        `);

        for (const loan of result.recordset) {
            await db.request()
                .input('LoanID', sql.BigInt, loan.LoanID)
                .input('TotalPaid', sql.Decimal(10,2), loan.TotalPaid + loan.RemainingBalance)
                .query(`UPDATE Loans SET RemainingBalance = 0, TotalPaid = @TotalPaid, Status = 'settled', SettledDate = GETDATE() WHERE LoanID = @LoanID`);
        }

        await logAudit(req.user.userId, req.user.username, 'LOAN_SETTLE', 'Loan', null, null,
            { settled: result.recordset.length }, 'Settled all active loans', req);

        res.json({ message: 'All active loans settled', settled: result.recordset.length });
    } catch (err) {
        logger.error('Settle all loans error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/loans/:id/defer
app.post('/api/loans/:id/defer', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const schema = Joi.object({
        deferMonths: Joi.number().integer().min(1).max(24).required(),
        deferStart: Joi.date().default(() => new Date()),
        note: Joi.string().allow('', null).max(255),
        confirm: Joi.string().valid('DEFER').required()
    });
    const { error, value } = schema.validate(req.body || {});
    if (error) return res.status(428).json(toApiValidationError(error));

    try {
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const loanId = parseInt(req.params.id, 10);
        if (!Number.isInteger(loanId)) return res.status(400).json({ error: 'Invalid loan ID' });
        const oldResult = await db.request().input('LoanID', sql.BigInt, loanId).query('SELECT * FROM Loans WHERE LoanID = @LoanID');
        const oldLoan = oldResult.recordset[0];
        if (!oldLoan) return res.status(404).json({ error: 'Loan not found' });

        const result = await db.request()
            .input('LoanID', sql.BigInt, loanId)
            .input('DeferMonths', sql.Int, value.deferMonths)
            .input('DeferStart', sql.Date, value.deferStart)
            .input('CreatedBy', sql.Int, req.user.userId)
            .input('Note', sql.NVarChar(255), value.note || 'EMI holiday / moratorium')
            .query('EXEC dbo.sp_ATLAS_DeferLoan @LoanID, @DeferMonths, @DeferStart, @CreatedBy, @Note');

        await logAudit(req.user.userId, req.user.username, 'LOAN_DEFER', 'Loan', loanId, oldLoan,
            result.recordset[0], `Deferred loan #${loanId} for ${value.deferMonths} month(s)`, req);
        res.json({ message: 'Loan deferred', loan: result.recordset[0] });
    } catch (err) {
        logger.error('Defer loan error:', err);
        res.status(500).json({ error: err.originalError?.info?.message || err.message || 'Server error' });
    }
});

// POST /api/loans/:id/restructure
app.post('/api/loans/:id/restructure', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const schema = Joi.object({
        newEmi: Joi.number().positive().allow(null),
        newTenureMonths: Joi.number().integer().min(1).max(240).allow(null),
        effectiveDate: Joi.date().default(() => new Date()),
        note: Joi.string().allow('', null).max(255),
        confirm: Joi.string().valid('RESTRUCTURE').required()
    }).or('newEmi', 'newTenureMonths');
    const { error, value } = schema.validate(req.body || {});
    if (error) return res.status(428).json(toApiValidationError(error));

    try {
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const loanId = parseInt(req.params.id, 10);
        if (!Number.isInteger(loanId)) return res.status(400).json({ error: 'Invalid loan ID' });
        const oldResult = await db.request().input('LoanID', sql.BigInt, loanId).query('SELECT * FROM Loans WHERE LoanID = @LoanID');
        const oldLoan = oldResult.recordset[0];
        if (!oldLoan) return res.status(404).json({ error: 'Loan not found' });

        const result = await db.request()
            .input('LoanID', sql.BigInt, loanId)
            .input('NewEMI', sql.Decimal(12, 2), value.newEmi || null)
            .input('NewTenureMonths', sql.Int, value.newTenureMonths || null)
            .input('EffectiveDate', sql.Date, value.effectiveDate)
            .input('CreatedBy', sql.Int, req.user.userId)
            .input('Note', sql.NVarChar(255), value.note || 'Loan EMI restructuring')
            .query('EXEC dbo.sp_ATLAS_RestructureLoanEMI @LoanID, @NewEMI, @NewTenureMonths, @EffectiveDate, @CreatedBy, @Note');

        await logAudit(req.user.userId, req.user.username, 'LOAN_RESTRUCTURE', 'Loan', loanId, oldLoan,
            result.recordset[0], `Restructured loan #${loanId}`, req);
        res.json({ message: 'Loan restructured', loan: result.recordset[0] });
    } catch (err) {
        logger.error('Restructure loan error:', err);
        res.status(500).json({ error: err.originalError?.info?.message || err.message || 'Server error' });
    }
});

// =====================================================
// AIRFARE POLICY RATE ROUTES
// =====================================================

app.get('/api/airfare-policy-rates', authenticateToken, requireRole('admin', 'manager', 'hr'), async (_req, res) => {
    try {
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const result = await withSqlRetry(() => db.request().query(`
            SELECT
                r.PolicyRateID,
                r.CompanyID,
                c.CompanyName,
                r.EmployeeID,
                e.EmployeeCode,
                e.FullName,
                r.Department,
                r.EmpGroup,
                r.EffectiveFrom,
                r.EffectiveTo,
                r.MaxPayoutAmount,
                r.CycleDays,
                r.WorkingDaysPerMonth,
                r.AirfareDaysPerMonth,
                CAST(r.MaxPayoutAmount / NULLIF(r.CycleDays, 0) AS DECIMAL(12,6)) AS PerDayRate,
                r.IsActive,
                r.CreatedAt
            FROM dbo.AirfarePolicyRates r
            LEFT JOIN dbo.Companies c ON c.CompanyID = r.CompanyID
            LEFT JOIN dbo.Employees e ON e.EmployeeID = r.EmployeeID
            ORDER BY r.IsActive DESC, r.EffectiveFrom DESC, r.PolicyRateID DESC
        `), 'get airfare policy rates');
        res.json(result.recordset);
    } catch (err) {
        logger.error('Get airfare policy rates error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/airfare-policy-rates', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const schema = Joi.object({
        ruleType: Joi.string().valid('global', 'company', 'employee', 'department', 'payGroup').default('global'),
        effectiveFrom: Joi.date().required(),
        maxPayoutAmount: Joi.number().positive().max(150).required(),
        companyId: Joi.number().integer().allow(null),
        employeeId: Joi.number().integer().allow(null),
        department: Joi.string().allow('', null).max(100),
        payGroup: Joi.string().allow('', null).max(100)
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json(toApiValidationError(error));

    try {
        const companyId = value.ruleType === 'company' ? value.companyId : null;
        const employeeId = value.ruleType === 'employee' ? value.employeeId : null;
        const department = value.ruleType === 'department' ? String(value.department || '').trim() : null;
        const payGroup = value.ruleType === 'payGroup' ? String(value.payGroup || '').trim() : null;
        if (value.ruleType === 'company' && !companyId) return res.status(400).json({ error: 'Select company for company max payout rule.' });
        if (value.ruleType === 'employee' && !employeeId) return res.status(400).json({ error: 'Select employee for employee exception rule.' });
        if (value.ruleType === 'department' && !department) return res.status(400).json({ error: 'Select department for department matrix rule.' });
        if (value.ruleType === 'payGroup' && !payGroup) return res.status(400).json({ error: 'Select pay group for pay group matrix rule.' });

        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const result = await withSqlRetry(() => db.request()
            .input('EffectiveFrom', sql.Date, value.effectiveFrom)
            .input('MaxPayoutAmount', sql.Decimal(12, 2), value.maxPayoutAmount)
            .input('CompanyID', sql.Int, companyId || null)
            .input('EmployeeID', sql.Int, employeeId || null)
            .input('Department', sql.NVarChar(100), department || null)
            .input('EmpGroup', sql.NVarChar(100), payGroup || null)
            .input('CreatedBy', sql.Int, req.user.userId)
            .execute('sp_ATLAS_SaveAirfarePolicyRate'), 'save airfare policy rate');
        const saved = result.recordset?.[0] || {};
        await logAudit(req.user.userId, req.user.username, 'UPSERT', 'AirfarePolicyRate', saved.PolicyRateID || null, null, saved,
            `Saved airfare policy ${Number(value.maxPayoutAmount).toFixed(2)} effective ${value.effectiveFrom} for ${employeeId ? `employee ${employeeId}` : companyId ? `company ${companyId}` : department ? `department ${department}` : payGroup ? `pay group ${payGroup}` : 'global scope'}`, req);
        res.status(201).json(saved);
    } catch (err) {
        logger.error('Save airfare policy rate error:', err);
        res.status(500).json({ error: err.originalError?.info?.message || err.message || 'Server error' });
    }
});

async function deactivateAirfarePolicyRate(req, res) {
    const policyRateId = Number(req.params.policyRateId);
    if (!Number.isInteger(policyRateId) || policyRateId <= 0) {
        return res.status(400).json({ error: 'Valid policy rate is required.' });
    }

    try {
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const oldResult = await withSqlRetry(() => db.request()
            .input('PolicyRateID', sql.BigInt, policyRateId)
            .query(`
                SELECT TOP 1
                    r.PolicyRateID,
                    r.CompanyID,
                    c.CompanyName,
                    r.EmployeeID,
                    e.EmployeeCode,
                    e.FullName,
                    r.Department,
                    r.EmpGroup,
                    r.EffectiveFrom,
                    r.EffectiveTo,
                    r.MaxPayoutAmount,
                    r.CycleDays,
                    r.WorkingDaysPerMonth,
                    r.AirfareDaysPerMonth,
                    CAST(r.MaxPayoutAmount / NULLIF(r.CycleDays, 0) AS DECIMAL(12,6)) AS PerDayRate,
                    r.IsActive,
                    r.CreatedAt
                FROM dbo.AirfarePolicyRates r
                LEFT JOIN dbo.Companies c ON c.CompanyID = r.CompanyID
                LEFT JOIN dbo.Employees e ON e.EmployeeID = r.EmployeeID
                WHERE r.PolicyRateID = @PolicyRateID
            `), 'get airfare policy rate before delete');
        const oldPolicy = oldResult.recordset?.[0];
        if (!oldPolicy) return res.status(404).json({ error: 'Airfare policy rule not found.' });
        if (!oldPolicy.IsActive || oldPolicy.EffectiveTo) {
            return res.json({
                message: 'Airfare policy rule is already historical. No change was needed.',
                policyRate: oldPolicy,
                alreadyHistorical: true
            });
        }

        const result = await withSqlRetry(() => db.request()
            .input('PolicyRateID', sql.BigInt, policyRateId)
            .query(`
                UPDATE dbo.AirfarePolicyRates
                   SET IsActive = 0,
                       EffectiveTo = CASE
                           WHEN EffectiveTo IS NOT NULL THEN EffectiveTo
                           WHEN CAST(SYSUTCDATETIME() AS DATE) < EffectiveFrom THEN EffectiveFrom
                           ELSE CAST(SYSUTCDATETIME() AS DATE)
                       END
                 OUTPUT
                    INSERTED.PolicyRateID,
                    INSERTED.CompanyID,
                    INSERTED.EmployeeID,
                    INSERTED.Department,
                    INSERTED.EmpGroup,
                    INSERTED.EffectiveFrom,
                    INSERTED.EffectiveTo,
                    INSERTED.MaxPayoutAmount,
                    INSERTED.CycleDays,
                    INSERTED.WorkingDaysPerMonth,
                    INSERTED.AirfareDaysPerMonth,
                    CAST(INSERTED.MaxPayoutAmount / NULLIF(INSERTED.CycleDays, 0) AS DECIMAL(12,6)) AS PerDayRate,
                    INSERTED.IsActive,
                    INSERTED.CreatedAt
                 WHERE PolicyRateID = @PolicyRateID;
            `), 'deactivate airfare policy rate');
        const deletedPolicy = result.recordset?.[0] || oldPolicy;
        await logAudit(req.user.userId, req.user.username, 'DELETE', 'AirfarePolicyRate', policyRateId, oldPolicy, deletedPolicy,
            `Deactivated airfare policy rate #${policyRateId}`, req);
        res.json({ message: 'Airfare policy rule removed from current rules.', policyRate: deletedPolicy });
    } catch (err) {
        logger.error('Delete airfare policy rate error:', err);
        res.status(500).json({ error: err.originalError?.info?.message || err.message || 'Server error' });
    }
}

app.delete('/api/airfare-policy-rates/:policyRateId', authenticateToken, requireRole('admin', 'manager'), deactivateAirfarePolicyRate);
app.post('/api/airfare-policy-rates/:policyRateId/delete', authenticateToken, requireRole('admin', 'manager'), deactivateAirfarePolicyRate);

// EMERGENCY TICKET ROUTES
// =====================================================

// GET /api/emergency-tickets
app.get('/api/emergency-tickets', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const result = await db.request().query(`
            SELECT t.*, e.EmployeeCode, e.FullName
            FROM EmergencyTickets t
            JOIN Employees e ON t.EmployeeID = e.EmployeeID
            ORDER BY 
                CASE t.Priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                t.TicketDate DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        logger.error('Get emergency tickets error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/emergency-tickets
app.post('/api/emergency-tickets', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    const ticket = req.body;
    try {
        const db = await getConnection();
        const result = await db.request()
            .input('EmployeeID', sql.Int, ticket.employeeId)
            .input('TicketType', sql.NVarChar(20), ticket.type)
            .input('Priority', sql.NVarChar(10), ticket.priority)
            .input('TicketDate', sql.Date, ticket.date)
            .input('Destination', sql.NVarChar(100), ticket.destination || null)
            .input('EstimatedCost', sql.Decimal(10,2), ticket.cost || 0)
            .input('Reason', sql.NVarChar(sql.MAX), ticket.reason)
            .input('ApproverName', sql.NVarChar(100), ticket.approver || null)
            .input('ApproverEmail', sql.NVarChar(100), ticket.approverEmail || null)
            .input('Status', sql.NVarChar(15), ticket.status || 'open')
            .input('CreatedBy', sql.Int, req.user.userId)
            .query(`INSERT INTO EmergencyTickets (EmployeeID, TicketType, Priority, TicketDate, Destination, EstimatedCost, Reason, ApproverName, ApproverEmail, Status, CreatedBy)
                    OUTPUT INSERTED.*
                    VALUES (@EmployeeID, @TicketType, @Priority, @TicketDate, @Destination, @EstimatedCost, @Reason, @ApproverName, @ApproverEmail, @Status, @CreatedBy)`);

        const newTicket = result.recordset[0];
        await logAudit(req.user.userId, req.user.username, 'CREATE', 'EmergencyTicket', newTicket.TicketID, null, newTicket, 
            `Created emergency ticket for employee ${ticket.employeeId}`, req);

        res.status(201).json(newTicket);
    } catch (err) {
        logger.error('Create emergency ticket error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/emergency-tickets/:id/status
app.put('/api/emergency-tickets/:id/status', authenticateToken, requireRole('admin', 'manager', 'hr'), async (req, res) => {
    const { status, resolution } = req.body;
    try {
        const db = await getConnection();
        const oldResult = await db.request()
            .input('TicketID', sql.BigInt, req.params.id)
            .query('SELECT * FROM EmergencyTickets WHERE TicketID = @TicketID');
        const oldValues = oldResult.recordset[0];

        if (!oldValues) return res.status(404).json({ error: 'Ticket not found' });

        await db.request()
            .input('TicketID', sql.BigInt, req.params.id)
            .input('Status', sql.NVarChar(15), status)
            .input('Resolution', sql.NVarChar(sql.MAX), resolution || null)
            .input('UpdatedBy', sql.Int, req.user.userId)
            .query(`UPDATE EmergencyTickets SET Status = @Status, Resolution = @Resolution, ResolvedAt = CASE WHEN @Status IN ('resolved','closed') THEN GETDATE() ELSE ResolvedAt END, UpdatedAt = GETDATE(), UpdatedBy = @UpdatedBy WHERE TicketID = @TicketID`);

        await logAudit(req.user.userId, req.user.username, 'UPDATE', 'EmergencyTicket', req.params.id, oldValues, 
            { status, resolution }, `Updated emergency ticket status to ${status}`, req);

        res.json({ message: 'Ticket updated' });
    } catch (err) {
        logger.error('Update emergency ticket error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// =====================================================
// AUDIT LOG ROUTES
// =====================================================

// GET /api/audit-logs
app.get('/api/audit-logs', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    try {
        const db = await getConnection();
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;

        const countResult = await db.request().query('SELECT COUNT(*) as Total FROM AuditLog');
        const total = countResult.recordset[0].Total;

        const result = await db.request()
            .input('Offset', sql.Int, offset)
            .input('Limit', sql.Int, limit)
            .query(`
                SELECT a.*, u.FullName as UserFullName
                FROM AuditLog a
                LEFT JOIN Users u ON a.UserID = u.UserID
                ORDER BY a.CreatedAt DESC
                OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY
            `);

        res.json({
            data: result.recordset,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) }
        });
    } catch (err) {
        logger.error('Get audit logs error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/audit-logs/entity/:type/:id
app.get('/api/audit-logs/entity/:type/:id', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const result = await db.request()
            .input('EntityType', sql.NVarChar(30), req.params.type)
            .input('EntityID', sql.BigInt, req.params.id)
            .query(`
                SELECT a.*, u.FullName as UserFullName
                FROM AuditLog a
                LEFT JOIN Users u ON a.UserID = u.UserID
                WHERE a.EntityType = @EntityType AND a.EntityID = @EntityID
                ORDER BY a.CreatedAt DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        logger.error('Get entity audit error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// =====================================================
// COMPANY, BACKUP AND RESTORE ROUTES
// =====================================================

// GET /api/public/companies/:code/logo
// Public login-brand endpoint: returns only the active company logo binary.
// It does not expose company records, user data, or protected settings.
app.get('/api/public/companies/:code/logo', async (req, res) => {
    try {
        const db = await getConnection();
        const result = await db.request()
            .input('CompanyCode', sql.NVarChar(30), String(req.params.code || '').toUpperCase())
            .query(`
                SELECT TOP 1 LogoMimeType, LogoData
                FROM dbo.Companies
                WHERE IsActive = 1
                  AND UPPER(CompanyCode) = @CompanyCode
                  AND LogoData IS NOT NULL
                ORDER BY CompanyID
            `);

        if (!result.recordset.length) return res.status(404).json({ error: 'Logo not found' });
        const logo = result.recordset[0];
        res.setHeader('Content-Type', logo.LogoMimeType || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.send(Buffer.from(logo.LogoData));
    } catch (err) {
        logger.error('Get public company logo error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/companies
app.get('/api/companies', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const db = await getConnection();
        const result = await db.request().query('EXEC dbo.sp_ATLAS_GetCompanies');
        res.json(result.recordset);
    } catch (err) {
        logger.error('Get companies error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/companies/:id/logo
app.get('/api/companies/:id/logo', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const result = await db.request()
            .input('CompanyID', sql.Int, req.params.id)
            .query('SELECT LogoMimeType, LogoData FROM dbo.Companies WHERE CompanyID = @CompanyID AND LogoData IS NOT NULL');

        if (!result.recordset.length) return res.status(404).json({ error: 'Logo not found' });
        const logo = result.recordset[0];
        res.setHeader('Content-Type', logo.LogoMimeType || 'application/octet-stream');
        res.send(Buffer.from(logo.LogoData));
    } catch (err) {
        logger.error('Get company logo error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/companies
app.post('/api/companies', authenticateToken, requireRole('admin'), async (req, res) => {
    const schema = Joi.object({
        companyCode: Joi.string().alphanum().max(30).required(),
        companyName: Joi.string().max(150).required(),
        databaseName: Joi.string().pattern(/^[A-Za-z0-9_]*$/).allow('', null),
        logoMimeType: Joi.string().valid('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml').allow('', null),
        logoDataBase64: Joi.string().allow('', null),
        address: Joi.string().max(300).allow('', null),
        phone: Joi.string().max(50).allow('', null),
        email: Joi.string().email().allow('', null),
        trn: Joi.string().max(50).allow('', null),
        contactPerson: Joi.string().max(120).allow('', null),
        isActive: Joi.boolean().default(true)
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
        const db = await getConnection();
        const databaseName = await ensureCompanyDatabase(db, value);
        const logoBuffer = value.logoDataBase64 ? Buffer.from(value.logoDataBase64, 'base64') : null;
        if (logoBuffer && logoBuffer.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'Logo must be 2 MB or smaller' });

        const result = await db.request()
            .input('CompanyID', sql.Int, null)
            .input('CompanyCode', sql.NVarChar(30), value.companyCode.toUpperCase())
            .input('CompanyName', sql.NVarChar(150), value.companyName)
            .input('DatabaseName', sql.NVarChar(128), databaseName)
            .input('LogoMimeType', sql.NVarChar(100), value.logoMimeType || null)
            .input('LogoData', sql.VarBinary(sql.MAX), logoBuffer)
            .input('Address', sql.NVarChar(300), value.address || null)
            .input('Phone', sql.NVarChar(50), value.phone || null)
            .input('Email', sql.NVarChar(150), value.email || null)
            .input('TRN', sql.NVarChar(50), value.trn || null)
            .input('ContactPerson', sql.NVarChar(120), value.contactPerson || null)
            .input('IsActive', sql.Bit, value.isActive)
            .input('UserID', sql.Int, req.user.userId)
            .query('EXEC dbo.sp_ATLAS_UpsertCompany @CompanyID, @CompanyCode, @CompanyName, @DatabaseName, @LogoMimeType, @LogoData, @Address, @Phone, @Email, @TRN, @ContactPerson, @IsActive, @UserID');

        await logAudit(req.user.userId, req.user.username, 'CREATE', 'Company', result.recordset[0].CompanyID, null, result.recordset[0],
            `Created company database ${databaseName}`, req);
        res.status(201).json(result.recordset[0]);
    } catch (err) {
        logger.error('Create company error:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
});

// PUT /api/companies/:id
app.put('/api/companies/:id', authenticateToken, requireRole('admin'), async (req, res) => {
    const schema = Joi.object({
        companyCode: Joi.string().alphanum().max(30).required(),
        companyName: Joi.string().max(150).required(),
        databaseName: Joi.string().pattern(/^[A-Za-z0-9_]*$/).allow('', null),
        logoMimeType: Joi.string().valid('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml').allow('', null),
        logoDataBase64: Joi.string().allow('', null),
        address: Joi.string().max(300).allow('', null),
        phone: Joi.string().max(50).allow('', null),
        email: Joi.string().email().allow('', null),
        trn: Joi.string().max(50).allow('', null),
        contactPerson: Joi.string().max(120).allow('', null),
        isActive: Joi.boolean().default(true)
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
        const db = await getConnection();
        const databaseName = await ensureCompanyDatabase(db, value);
        const logoBuffer = value.logoDataBase64 ? Buffer.from(value.logoDataBase64, 'base64') : null;
        if (logoBuffer && logoBuffer.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'Logo must be 2 MB or smaller' });

        const result = await db.request()
            .input('CompanyID', sql.Int, req.params.id)
            .input('CompanyCode', sql.NVarChar(30), value.companyCode.toUpperCase())
            .input('CompanyName', sql.NVarChar(150), value.companyName)
            .input('DatabaseName', sql.NVarChar(128), databaseName)
            .input('LogoMimeType', sql.NVarChar(100), value.logoMimeType || null)
            .input('LogoData', sql.VarBinary(sql.MAX), logoBuffer)
            .input('Address', sql.NVarChar(300), value.address || null)
            .input('Phone', sql.NVarChar(50), value.phone || null)
            .input('Email', sql.NVarChar(150), value.email || null)
            .input('TRN', sql.NVarChar(50), value.trn || null)
            .input('ContactPerson', sql.NVarChar(120), value.contactPerson || null)
            .input('IsActive', sql.Bit, value.isActive)
            .input('UserID', sql.Int, req.user.userId)
            .query('EXEC dbo.sp_ATLAS_UpsertCompany @CompanyID, @CompanyCode, @CompanyName, @DatabaseName, @LogoMimeType, @LogoData, @Address, @Phone, @Email, @TRN, @ContactPerson, @IsActive, @UserID');

        await logAudit(req.user.userId, req.user.username, 'UPDATE', 'Company', req.params.id, null, result.recordset[0],
            `Updated company database ${databaseName}`, req);
        res.json(result.recordset[0]);
    } catch (err) {
        logger.error('Update company error:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
});

// DELETE /api/companies/empty
app.delete('/api/companies/empty', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const keepCompanyId = req.body?.keepCompanyId ? Number(req.body.keepCompanyId) : null;
        const db = await getConnection();
        const candidates = await db.request()
            .input('KeepCompanyID', sql.Int, Number.isFinite(keepCompanyId) ? keepCompanyId : null)
            .query(`
                SELECT c.CompanyID, c.CompanyCode, c.CompanyName, c.DatabaseName
                FROM dbo.Companies c
                WHERE UPPER(ISNULL(c.CompanyCode, '')) <> 'ATLAS'
                  AND UPPER(ISNULL(c.CompanyName, '')) <> 'ATLAS'
                  AND (@KeepCompanyID IS NULL OR c.CompanyID <> @KeepCompanyID)
                  AND NOT EXISTS (
                      SELECT 1
                      FROM dbo.Employees e
                      WHERE UPPER(LTRIM(RTRIM(ISNULL(e.Company, '')))) IN (
                          UPPER(LTRIM(RTRIM(ISNULL(c.CompanyCode, '')))),
                          UPPER(LTRIM(RTRIM(ISNULL(c.CompanyName, '')))),
                          UPPER(LTRIM(RTRIM(ISNULL(c.DatabaseName, ''))))
                      )
                  )
                  AND NOT EXISTS (
                      SELECT 1
                      FROM dbo.AirfarePolicyRates r
                      WHERE r.CompanyID = c.CompanyID
                  )
                ORDER BY c.CompanyID
            `);

        const rows = candidates.recordset || [];
        if (!rows.length) return res.json({ deleted: 0, companies: [] });

        const ids = rows.map((row) => Number(row.CompanyID)).filter(Number.isFinite);
        const idList = ids.join(',');
        await db.request().query(`DELETE FROM dbo.Companies WHERE CompanyID IN (${idList})`);

        await logAudit(req.user.userId, req.user.username, 'DELETE_EMPTY', 'Company', null, rows, null,
            `Deleted ${rows.length} empty company record(s)`, req);

        res.json({ deleted: rows.length, companies: rows });
    } catch (err) {
        logger.error('Delete empty companies error:', err);
        res.status(500).json({ error: err.message || 'Delete empty companies failed' });
    }
});

// DELETE /api/companies/:id
app.delete('/api/companies/:id(\\d+)', authenticateToken, requireRole('admin'), async (req, res) => {
    const schema = Joi.object({
        confirm: Joi.string().valid('DELETE_COMPANY_AND_DATABASE').required()
    });
    const { error, value } = schema.validate(req.body || {});
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
        const companyId = Number(req.params.id);
        const db = await getConnection();
        const companyResult = await db.request()
            .input('CompanyID', sql.Int, companyId)
            .query('SELECT TOP 1 * FROM dbo.Companies WHERE CompanyID = @CompanyID');
        if (!companyResult.recordset.length) return res.status(404).json({ error: 'Company not found' });

        const company = companyResult.recordset[0];
        const databaseName = String(company.DatabaseName || '').trim();
        if (String(company.CompanyCode || '').toUpperCase() === 'ATLAS' || String(company.CompanyName || '').toUpperCase() === 'ATLAS') {
            return res.status(400).json({ error: 'Main ATLAS company cannot be deleted.' });
        }
        if (!databaseName || databaseName.toLowerCase() === String(dbConfig.database || '').toLowerCase()) {
            return res.status(400).json({ error: 'Main ATLAS database cannot be dropped.' });
        }

        const usage = await db.request()
            .input('CompanyID', sql.Int, companyId)
            .input('CompanyCode', sql.NVarChar(30), company.CompanyCode || '')
            .input('CompanyName', sql.NVarChar(150), company.CompanyName || '')
            .input('DatabaseName', sql.NVarChar(128), databaseName)
            .query(`
                SELECT
                    (SELECT COUNT(*) FROM dbo.Employees e
                     WHERE UPPER(LTRIM(RTRIM(ISNULL(e.Company, '')))) IN (
                        UPPER(LTRIM(RTRIM(ISNULL(@CompanyCode, '')))),
                        UPPER(LTRIM(RTRIM(ISNULL(@CompanyName, '')))),
                        UPPER(LTRIM(RTRIM(ISNULL(@DatabaseName, ''))))
                     )) AS Employees,
                    (SELECT COUNT(*) FROM dbo.AirfarePolicyRates WHERE CompanyID = @CompanyID) AS PolicyRates
            `);
        const linked = usage.recordset[0] || {};
        if (Number(linked.Employees || 0) > 0 || Number(linked.PolicyRates || 0) > 0) {
            return res.status(409).json({
                error: 'Company is linked to employees or policy values. Remove links before deleting.',
                details: {
                    employees: Number(linked.Employees || 0),
                    policyRates: Number(linked.PolicyRates || 0)
                }
            });
        }

        const safeDatabase = sqlIdentifier(databaseName);
        const databaseExists = await db.request()
            .input('DatabaseName', sql.NVarChar(128), databaseName)
            .query('SELECT DB_ID(@DatabaseName) AS DatabaseID');

        if (databaseExists.recordset[0]?.DatabaseID) {
            await db.request().query(`ALTER DATABASE ${safeDatabase} SET SINGLE_USER WITH ROLLBACK IMMEDIATE`);
            await db.request().query(`DROP DATABASE ${safeDatabase}`);
        }

        await db.request()
            .input('CompanyID', sql.Int, companyId)
            .query('DELETE FROM dbo.Companies WHERE CompanyID = @CompanyID');

        await logAudit(req.user.userId, req.user.username, 'DELETE', 'Company', companyId, company, null,
            `Deleted company ${company.CompanyName} and dropped database ${databaseName}`, req);

        res.json({ deleted: true, companyId, companyName: company.CompanyName, databaseName, databaseDropped: Boolean(databaseExists.recordset[0]?.DatabaseID) });
    } catch (err) {
        logger.error('Delete company error:', err);
        res.status(500).json({ error: err.message || 'Delete company failed' });
    }
});

// POST /api/admin/backup
function getAtlasBackupRoots() {
    const roots = [];
    const configuredDataRoot = process.env.ATLAS_DATA_ROOT || process.env.DATA_ROOT;
    if (configuredDataRoot) roots.push(path.resolve(configuredDataRoot, 'backups'));
    if (process.env.ProgramData || process.env.PROGRAMDATA) {
        roots.push(path.resolve(process.env.ProgramData || process.env.PROGRAMDATA, 'ATLAS Airfare Allowance', 'backups'));
    }
    roots.push(path.resolve(__dirname, 'backups'));
    return [...new Set(roots.map((item) => path.resolve(item)))];
}

function getWritableBackupDir() {
    const roots = getAtlasBackupRoots();
    for (const root of roots) {
        try {
            fs.mkdirSync(root, { recursive: true });
            fs.accessSync(root, fs.constants.W_OK);
            return root;
        } catch (err) {
            logger.warn(`Backup folder is not writable: ${root}`, err.message);
        }
    }
    throw new Error('No writable ATLAS backup folder is available.');
}

function assertBackupInsideKnownRoot(backupFile) {
    const resolvedBackup = path.resolve(backupFile || '');
    const roots = getAtlasBackupRoots();
    const allowed = roots.some((root) => {
        const normalizedRoot = path.resolve(root);
        return resolvedBackup === normalizedRoot || resolvedBackup.startsWith(`${normalizedRoot}${path.sep}`);
    });
    if (!allowed || !fs.existsSync(resolvedBackup)) {
        const rootList = roots.join('; ');
        throw new Error(`Backup file must exist inside an ATLAS backups folder: ${rootList}`);
    }
    return resolvedBackup;
}

async function verifySqlBackupMedia(connection, backupFile) {
    await connection.request().query(`RESTORE VERIFYONLY FROM DISK = ${sqlLiteral(backupFile)} WITH CHECKSUM`);
}

app.post('/api/admin/backup', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const databaseName = req.body.databaseName || dbConfig.database;
        const safeDatabase = sqlIdentifier(databaseName);
        const backupDir = getWritableBackupDir();
        const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
        const backupFile = path.join(backupDir, `${databaseName}_${timestamp}.bak`);

        const db = await getConnection();
        await db.request().query(`BACKUP DATABASE ${safeDatabase} TO DISK = ${sqlLiteral(backupFile)} WITH INIT, COPY_ONLY, CHECKSUM, STATS = 10`);
        await verifySqlBackupMedia(db, backupFile);
        await db.request()
            .input('DatabaseName', sql.NVarChar(128), databaseName)
            .input('BackupFile', sql.NVarChar(500), backupFile)
            .input('CreatedBy', sql.Int, req.user.userId)
            .query(`INSERT INTO dbo.CompanyBackups (DatabaseName, BackupFile, BackupType, Status, CreatedBy)
                    VALUES (@DatabaseName, @BackupFile, 'full', 'completed', @CreatedBy)`);

        await logAudit(req.user.userId, req.user.username, 'BACKUP', 'Database', null, null, { databaseName, backupFile },
            `Created backup for ${databaseName}`, req);
        res.json({ databaseName, backupFile });
    } catch (err) {
        logger.error('Backup error:', err);
        res.status(500).json({ error: err.message || 'Backup failed' });
    }
});

// GET /api/admin/backups
app.get('/api/admin/backups', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const files = getAtlasBackupRoots()
            .flatMap((backupDir) => {
                try {
                    fs.mkdirSync(backupDir, { recursive: true });
                    return fs.readdirSync(backupDir)
                        .filter((name) => name.toLowerCase().endsWith('.bak'))
                        .map((name) => {
                            const fullPath = path.join(backupDir, name);
                            const stat = fs.statSync(fullPath);
                            return {
                                fileName: name,
                                backupFile: fullPath,
                                databaseName: name.replace(/_\d{14}\.bak$/i, ''),
                                sizeBytes: stat.size,
                                createdAt: stat.mtime
                            };
                        });
                } catch (err) {
                    logger.warn(`Backup list folder skipped: ${backupDir}`, err.message);
                    return [];
                }
            })
            .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

        res.json(files);
    } catch (err) {
        logger.error('List backups error:', err);
        res.status(500).json({ error: err.message || 'Backup list failed' });
    }
});

// POST /api/admin/restore
app.post('/api/admin/restore', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const { databaseName, backupFile, confirm } = req.body;
        if (confirm !== 'RESTORE') return res.status(400).json({ error: 'Restore requires confirmation' });
        const safeDatabase = sqlIdentifier(databaseName);
        const resolvedBackup = assertBackupInsideKnownRoot(backupFile);

        await closeSharedConnection();
        const adminDb = await getAdminConnection('master');
        try {
            await verifySqlBackupMedia(adminDb, resolvedBackup);
            await adminDb.request().query(`ALTER DATABASE ${safeDatabase} SET SINGLE_USER WITH ROLLBACK IMMEDIATE`);
            await adminDb.request().query(`RESTORE DATABASE ${safeDatabase} FROM DISK = ${sqlLiteral(resolvedBackup)} WITH REPLACE, CHECKSUM, STATS = 10`);
        } finally {
            try {
                await adminDb.request().query(`ALTER DATABASE ${safeDatabase} SET MULTI_USER`);
            } catch (multiUserErr) {
                logger.error('Restore cleanup MULTI_USER error:', multiUserErr);
            }
            await adminDb.close();
        }
        await getConnection();

        await logAudit(req.user.userId, req.user.username, 'RESTORE', 'Database', null, null, { databaseName, backupFile: resolvedBackup },
            `Restored database ${databaseName}`, req);
        res.json({ databaseName, restored: true });
    } catch (err) {
        logger.error('Restore error:', err);
        res.status(500).json({ error: err.message || 'Restore failed' });
    }
});

// =====================================================
// =====================================================
// ADMIN DATA MAINTENANCE ROUTES
// =====================================================

// DELETE /api/admin/business-data
app.delete('/api/admin/business-data', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const db = await getConnection();
        const before = await db.request().query(`
            SELECT
                (SELECT COUNT(*) FROM Employees) AS Employees,
                (SELECT COUNT(*) FROM Allocations) AS Allocations,
                (SELECT COUNT(*) FROM Loans) AS Loans,
                (SELECT COUNT(*) FROM EmergencyTickets) AS EmergencyTickets,
                (SELECT COUNT(*) FROM OpeningBalances) AS OpeningBalances,
                (SELECT COUNT(*) FROM YearEndHistory) AS YearEndHistory
        `);

        await db.request().query(`
            DELETE FROM LoanHistory;
            DELETE FROM Loans;
            DELETE FROM EmergencyTickets;
            DELETE FROM OpeningBalances;
            DELETE FROM YearEndHistory;
            DELETE FROM AllocationAttachments;
            DELETE FROM Allocations;
            DELETE FROM Employees;
        `);

        await logAudit(req.user.userId, req.user.username, 'DELETE', 'System', null, before.recordset[0], null,
            'Deleted all business data', req);

        res.json({ message: 'All business data deleted', deleted: before.recordset[0] });
    } catch (err) {
        logger.error('Delete business data error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});
// REPORT ROUTES
// =====================================================

app.get('/api/intelligence/control-center', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const asOfDate = req.query.asOfDate || null;
        const currentYear = req.query.year ? parseInt(req.query.year, 10) : null;
        const result = await db.request()
            .input('AsOfDate', sql.Date, asOfDate)
            .input('CurrentYear', sql.Int, Number.isInteger(currentYear) ? currentYear : null)
            .execute('dbo.sp_ATLAS_GetIntelligenceControlCenter');

        res.json({
            summary: result.recordsets?.[0]?.[0] || {},
            risks: result.recordsets?.[1] || [],
            recommendations: result.recordsets?.[2] || []
        });
    } catch (err) {
        logger.error('Intelligence control center error:', err);
        res.status(500).json({ error: err.message || 'Intelligence control center failed' });
    }
});

app.get('/api/intelligence/verification', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const asOfDate = req.query.asOfDate || null;
        const currentYear = req.query.year ? parseInt(req.query.year, 10) : null;
        const result = await db.request()
            .input('AsOfDate', sql.Date, asOfDate)
            .input('CurrentYear', sql.Int, Number.isInteger(currentYear) ? currentYear : null)
            .execute('dbo.sp_ATLAS_RunSystemVerification');

        res.json({
            summary: result.recordsets?.[0]?.[0] || {},
            checks: result.recordsets?.[1] || []
        });
    } catch (err) {
        logger.error('System verification error:', err);
        res.status(500).json({ error: err.message || 'System verification failed' });
    }
});

app.get('/api/intelligence/system-integrity', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const asOfDate = req.query.asOfDate || null;
        const currentYear = req.query.year ? parseInt(req.query.year, 10) : null;

        const controlResult = await db.request()
            .input('AsOfDate', sql.Date, asOfDate)
            .input('CurrentYear', sql.Int, Number.isInteger(currentYear) ? currentYear : null)
            .execute('dbo.sp_ATLAS_GetIntelligenceControlCenter');
        const verificationResult = await db.request()
            .input('AsOfDate', sql.Date, asOfDate)
            .input('CurrentYear', sql.Int, Number.isInteger(currentYear) ? currentYear : null)
            .execute('dbo.sp_ATLAS_RunSystemVerification');
        const diagnostics = await runSystemDiagnostics();

        const model = buildAutomaticVerificationModel({
            controlCenter: {
                summary: controlResult.recordsets?.[0]?.[0] || {},
                risks: controlResult.recordsets?.[1] || [],
                recommendations: controlResult.recordsets?.[2] || []
            },
            verification: {
                summary: verificationResult.recordsets?.[0]?.[0] || {},
                checks: verificationResult.recordsets?.[1] || []
            },
            diagnostics,
            currentYear,
            asOfDate
        });

        res.json(model);
    } catch (err) {
        logger.error('System integrity model error:', err);
        res.status(500).json({ error: err.message || 'System integrity model failed' });
    }
});

app.get('/api/diagnostics/database', authenticateToken, async (req, res) => {
    const started = Date.now();
    try {
        const db = await getConnection();
        await db.request().query('SELECT 1 AS HealthCheck');
        const latencyMs = Date.now() - started;
        res.json({
            name: 'MSSQL database',
            success: true,
            latencyMs,
            status: diagnosticStatus(true, latencyMs, 300),
            database: dbConfig.database,
            server: dbConfig.server,
            checkedAt: new Date().toISOString()
        });
    } catch (err) {
        res.status(503).json({
            name: 'MSSQL database',
            success: false,
            latencyMs: Date.now() - started,
            status: 'DOWN',
            database: dbConfig.database,
            server: dbConfig.server,
            error: err.message,
            checkedAt: new Date().toISOString()
        });
    }
});

app.get('/api/diagnostics/external-apis', authenticateToken, async (req, res) => {
    const urls = parseExternalHealthUrls();
    if (urls.length === 0) {
        return res.json({
            status: 'IDLE',
            checkedAt: new Date().toISOString(),
            services: [],
            message: 'No external API health URLs configured.'
        });
    }

    const settled = await Promise.allSettled(urls.map((url) => fetchWithTimeout(url, 5000)));
    const services = settled.map((result, index) => {
        if (result.status === 'fulfilled') return result.value;
        return {
            name: urls[index],
            url: urls[index],
            success: false,
            latencyMs: 5000,
            status: 'DOWN',
            error: result.reason?.message || 'External API check failed',
            checkedAt: new Date().toISOString()
        };
    });
    const status = summarizeDiagnostics(services);
    res.status(status === 'DEGRADED' ? 207 : status === 'DOWN' ? 207 : 200).json({
        status,
        checkedAt: new Date().toISOString(),
        services
    });
});

app.get('/api/diagnostics/system', authenticateToken, async (req, res) => {
    const diagnostics = await runSystemDiagnostics();
    res.status(diagnostics.status === 'DOWN' || diagnostics.status === 'DEGRADED' ? 207 : 200).json(diagnostics);
});

// GET /api/reports/employee-master
app.get('/api/reports/employee-master', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const result = await db.request().query('EXEC dbo.sp_ATLAS_GetEmployeeMaster');
        res.json(result.recordset);
    } catch (err) {
        logger.error('Employee master report error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/reports/year-summary/:year
app.get('/api/reports/year-summary/:year', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        const year = parseInt(req.params.year);

        const allocResult = await db.request()
            .input('Year', sql.Int, year)
            .query(`
                SELECT COUNT(*) as TotalAllocations, ISNULL(SUM(TicketCost),0) as TotalTickets, ISNULL(SUM(CompanyPaid),0) as CompanyPaid
                FROM Allocations WHERE AllocYear = @Year
            `);

        const loanResult = await db.request()
            .input('Year', sql.Int, year)
            .query(`
                SELECT COUNT(*) as TotalLoans, ISNULL(SUM(OriginalAmount),0) as TotalLoanAmount
                FROM Loans WHERE YEAR(CreatedDate) = @Year
            `);

        const emergencyResult = await db.request()
            .input('Year', sql.Int, year)
            .query(`
                SELECT COUNT(*) as TotalEmergency FROM EmergencyTickets WHERE YEAR(TicketDate) = @Year
            `);

        res.json({
            year,
            allocations: allocResult.recordset[0],
            loans: loanResult.recordset[0],
            emergencyTickets: emergencyResult.recordset[0]
        });
    } catch (err) {
        logger.error('Year summary error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/reports/airfare-payable
app.get('/api/reports/airfare-payable', authenticateToken, async (req, res) => {
    try {
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
        const asOfDate = req.query.asOfDate || null;
        if (!year || year < 2000 || year > 2100) {
            return res.status(400).json({ error: 'Valid report year is required' });
        }
        const result = await withSqlRetry(() => db.request()
            .input('ReportYear', sql.Int, year)
            .input('AsOfDate', sql.Date, asOfDate)
            .execute('dbo.sp_ATLAS_GetAirfareReport'), 'airfare payable report');
        const rows = result.recordset.map((row) => {
            const maxPayout = clampAirfareMaximumPayout(row.MaximumPayoutCap || row.AnnualEntitlementBHD);
            const fullPayableFromDays = Math.max(0, Number(row.BalanceDays || 0) * Number(row.PerDayRate || 2.5));
            const payable = fullPayableFromDays;
            const entitlement = Math.min(maxPayout, Math.max(0, Number(row.AirfareEntitlementAmount ?? payable)));
            return {
                ...row,
                AirfareEntitlementAmount: Number(entitlement.toFixed(2)),
                PayableBHD: Number(payable.toFixed(2))
            };
        });
        res.json(rows);
    } catch (err) {
        logger.error('Airfare payable report error:', err);
        res.status(500).json({ error: err.message || 'Airfare payable report failed' });
    }
});

// GET /api/year-end/preview/:year
app.get('/api/year-end/preview/:year', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const closedYear = parseInt(req.params.year);
        const scopeEmployeeId = req.query.employeeId ? parseInt(req.query.employeeId) : null;
        const closingDate = req.query.closingDate || `${closedYear}-12-31`;
        if (!closedYear || closedYear < 2000 || closedYear > 2100) {
            return res.status(400).json({ error: 'Valid year is required' });
        }

        const employees = await withSqlRetry(() => db.request()
            .input('Year', sql.Int, closedYear)
            .input('ClosingDate', sql.Date, closingDate)
            .input('EmployeeID', sql.Int, scopeEmployeeId)
            .query('EXEC dbo.sp_ATLAS_GetYearEndPreview @ClosedYear = @Year, @ClosingDate = @ClosingDate, @EmployeeID = @EmployeeID'), 'year-end preview');

        const counts = await db.request()
            .input('Year', sql.Int, closedYear)
            .query(`
                SELECT
                    (SELECT COUNT(*) FROM Allocations WHERE AllocYear = @Year) AS TotalAllocations,
                    (SELECT COUNT(*) FROM Loans WHERE YEAR(CreatedDate) = @Year) AS TotalLoansCreated,
                    (SELECT COUNT(*) FROM EmergencyTickets WHERE YEAR(TicketDate) = @Year) AS TotalEmergencyTickets,
                    (SELECT COUNT(*) FROM Loans WHERE ISNULL(RemainingBalance, 0) > 0 AND ISNULL(Status, 'active') <> 'settled') AS PendingLoans,
                    (SELECT ISNULL(SUM(RemainingBalance), 0) FROM Loans WHERE ISNULL(RemainingBalance, 0) > 0 AND ISNULL(Status, 'active') <> 'settled') AS PendingLoanAmount
            `);

        const totalOpeningBalance = employees.recordset.reduce((sum, row) => sum + Number(row.ClosingBHD || 0), 0);
        const totalClosingDays = employees.recordset.reduce((sum, row) => sum + Number(row.ClosingDays || 0), 0);
        const pendingLoanCount = employees.recordset.reduce((sum, row) => sum + Number(row.PendingLoanCount || 0), 0);
        const pendingLoanAmount = employees.recordset.reduce((sum, row) => sum + Number(row.PendingLoanAmount || 0), 0);
        res.json({
            closedYear,
            nextYear: closedYear + 1,
            closingDate,
            employeeCount: employees.recordset.length,
            balancesCarried: employees.recordset.length,
            totalOpeningBalance: Number(totalOpeningBalance.toFixed(2)),
            totalClosingDays: Number(totalClosingDays.toFixed(2)),
            pendingLoanCount,
            pendingLoanAmount: Number(pendingLoanAmount.toFixed(2)),
            totals: counts.recordset[0],
            employees: employees.recordset
        });
    } catch (err) {
        logger.error('Year-end preview error:', err);
        res.status(500).json({ error: err.message || 'Year-end preview failed' });
    }
});

// POST /api/year-end/close
app.post('/api/year-end/close', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const schema = Joi.object({
            year: Joi.number().integer().min(2000).max(2100).required(),
            closingDate: Joi.date().allow(null),
            employeeId: Joi.number().integer().allow(null),
            remarks: Joi.string().max(500).allow('', null),
            dryRun: Joi.boolean().default(false)
        });
        const { error, value } = schema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        const closedYear = value.year;
        const nextYear = closedYear + 1;
        const closingDate = value.closingDate || `${closedYear}-12-31`;

        const preview = await withSqlRetry(() => db.request()
            .input('Year', sql.Int, closedYear)
            .input('ClosingDate', sql.Date, closingDate)
            .input('EmployeeID', sql.Int, value.employeeId || null)
            .query('EXEC dbo.sp_ATLAS_GetYearEndPreview @ClosedYear = @Year, @ClosingDate = @ClosingDate, @EmployeeID = @EmployeeID'), 'year-end close preview');

        const totals = await db.request()
            .input('Year', sql.Int, closedYear)
            .query(`
                SELECT
                    (SELECT COUNT(*) FROM Allocations WHERE AllocYear = @Year) AS TotalAllocations,
                    (SELECT COUNT(*) FROM Loans WHERE YEAR(CreatedDate) = @Year) AS TotalLoansCreated,
                    (SELECT COUNT(*) FROM EmergencyTickets WHERE YEAR(TicketDate) = @Year) AS TotalEmergencyTickets,
                    (SELECT COUNT(*) FROM Loans WHERE ISNULL(RemainingBalance, 0) > 0 AND ISNULL(Status, 'active') <> 'settled') AS PendingLoans,
                    (SELECT ISNULL(SUM(RemainingBalance), 0) FROM Loans WHERE ISNULL(RemainingBalance, 0) > 0 AND ISNULL(Status, 'active') <> 'settled') AS PendingLoanAmount
            `);

        const totalOpeningBalance = preview.recordset.reduce((sum, row) => sum + Number(row.ClosingBHD || 0), 0);
        const totalClosingDays = preview.recordset.reduce((sum, row) => sum + Number(row.ClosingDays || 0), 0);
        const pendingLoanCount = preview.recordset.reduce((sum, row) => sum + Number(row.PendingLoanCount || 0), 0);
        const pendingLoanAmount = preview.recordset.reduce((sum, row) => sum + Number(row.PendingLoanAmount || 0), 0);
        const summary = {
            closedYear,
            nextYear,
            closingDate,
            employeeCount: preview.recordset.length,
            balancesCarried: preview.recordset.length,
            totalOpeningBalance: Number(totalOpeningBalance.toFixed(2)),
            totalClosingDays: Number(totalClosingDays.toFixed(2)),
            pendingLoanCount,
            pendingLoanAmount: Number(pendingLoanAmount.toFixed(2)),
            totals: totals.recordset[0],
            dryRun: value.dryRun
        };

        if (value.dryRun) return res.json({ ...summary, employees: preview.recordset });

        const existingClose = await db.request()
            .input('ClosedYear', sql.Int, closedYear)
            .query('SELECT TOP 1 YearEndID FROM YearEndHistory WHERE ClosedYear = @ClosedYear');
        if (existingClose.recordset[0]) {
            return res.status(409).json({
                code: 'YEAR_END_ALREADY_CLOSED',
                error: `Year ${closedYear} has already been closed.`,
                yearEndId: existingClose.recordset[0].YearEndID
            });
        }

        const tx = new sql.Transaction(db);
        await tx.begin();
        try {
            for (const row of preview.recordset) {
                await new sql.Request(tx)
                    .input('EmployeeID', sql.Int, row.EmployeeID)
                    .input('BalanceYear', sql.Int, nextYear)
                    .input('OpeningDays', sql.Decimal(10, 4), Number(row.ClosingDays || 0))
                    .input('OpeningBHD', sql.Decimal(10, 2), Number(row.ClosingBHD || 0))
                    .input('CarriedFromYear', sql.Int, closedYear)
                    .query(`
                        MERGE OpeningBalances AS target
                        USING (SELECT @EmployeeID AS EmployeeID, @BalanceYear AS BalanceYear) AS source
                        ON target.EmployeeID = source.EmployeeID AND target.BalanceYear = source.BalanceYear
                        WHEN MATCHED THEN UPDATE SET OpeningDays = @OpeningDays, OpeningBHD = @OpeningBHD, CarriedFromYear = @CarriedFromYear
                        WHEN NOT MATCHED THEN INSERT (EmployeeID, BalanceYear, OpeningDays, OpeningBHD, CarriedFromYear)
                            VALUES (@EmployeeID, @BalanceYear, @OpeningDays, @OpeningBHD, @CarriedFromYear);
                    `);
            }

            const history = await new sql.Request(tx)
                .input('ClosedYear', sql.Int, closedYear)
                .input('NextYear', sql.Int, nextYear)
                .input('ClosingDate', sql.Date, closingDate)
                .input('EmployeeCount', sql.Int, summary.employeeCount)
                .input('BalancesCarried', sql.Int, summary.balancesCarried)
                .input('TotalAllocations', sql.Int, summary.totals.TotalAllocations || 0)
                .input('TotalLoansCreated', sql.Int, summary.totals.TotalLoansCreated || 0)
                .input('TotalEmergencyTickets', sql.Int, summary.totals.TotalEmergencyTickets || 0)
                .input('TotalOpeningBalance', sql.Decimal(12, 2), summary.totalOpeningBalance)
                .input('Remarks', sql.NVarChar(sql.MAX), value.remarks || null)
                .input('ClosedBy', sql.Int, req.user.userId)
                .query(`
                    INSERT INTO YearEndHistory (ClosedYear, NextYear, ClosingDate, EmployeeCount, BalancesCarried,
                        TotalAllocations, TotalLoansCreated, TotalEmergencyTickets, TotalOpeningBalance, Remarks, ClosedBy)
                    OUTPUT INSERTED.*
                    VALUES (@ClosedYear, @NextYear, @ClosingDate, @EmployeeCount, @BalancesCarried,
                        @TotalAllocations, @TotalLoansCreated, @TotalEmergencyTickets, @TotalOpeningBalance, @Remarks, @ClosedBy)
                `);

            await tx.commit();
            await logAudit(req.user.userId, req.user.username, 'YEAR_END_CLOSE', 'YearEnd', history.recordset[0].YearEndID, null,
                { ...summary, history: history.recordset[0] }, `Closed year ${closedYear}`, req);
            res.json({ ...summary, yearEndId: history.recordset[0].YearEndID });
        } catch (innerErr) {
            await tx.rollback();
            throw innerErr;
        }
    } catch (err) {
        logger.error('Year-end close error:', err);
        res.status(500).json({ error: err.message || 'Year-end close failed' });
    }
});

// =====================================================
// HEALTH CHECK
// =====================================================
app.get('/api/health', async (req, res) => {
    try {
        const db = await getConnection();
        await db.request().query('SELECT 1');
        res.json({ status: 'healthy', database: 'connected', timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(503).json({ status: 'unhealthy', database: 'disconnected', error: err.message });
    }
});

// =====================================================
// ERROR HANDLER
// =====================================================
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// =====================================================
// START SERVER
// =====================================================
const httpServer = app.listen(PORT, HOST, async () => {
    try {
        const db = await getConnection();
        await ensureAtlasSqlObjects(db);
        logger.info(`ATLAS API Server running on ${HOST}:${PORT}`);
        logger.info(`Database: ${dbConfig.database} on ${dbConfig.server}`);
    } catch (err) {
        logger.error('Failed to connect to database:', err);
        process.exit(1);
    }
});

httpServer.on('error', (err) => {
    logger.error(`ATLAS bind failed on ${HOST}:${PORT}:`, err);
    process.exit(1);
});

module.exports = app;






