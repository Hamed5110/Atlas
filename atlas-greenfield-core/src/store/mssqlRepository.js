import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sql from "mssql";
import { defaultSeed } from "./greenfieldStore.js";
import { isIsoDate, normalizeEmployee } from "../domain/employees.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function createMssqlRepository(options = {}) {
  const config = readConfig(options);
  await ensureDatabase(config);
  const pool = await new sql.ConnectionPool(poolConfig(config.database, config)).connect();
  await applyCoreSchema(pool);
  await seedCoreData(pool);
  return new MssqlRepository(pool, config);
}

class MssqlRepository {
  constructor(pool, config) {
    this.pool = pool;
    this.config = config;
    this.repository = "mssql-core";
  }

  async snapshot() {
    return { repository: this.repository, database: this.config.database };
  }

  async listTenants() {
    const result = await this.pool.request().query(`
      SELECT TenantID AS tenantId, TenantCode AS tenantCode, TenantName AS tenantName, IsActive AS isActive
      FROM core.Tenants
      ORDER BY TenantCode;
    `);
    return result.recordset;
  }

  async listCompanies(tenantId) {
    const request = this.pool.request().input("TenantID", sql.UniqueIdentifier, tenantId || null);
    const result = await request.query(`
      SELECT CompanyID AS companyId, TenantID AS tenantId, CompanyCode AS companyCode, CompanyName AS companyName, BaseCurrencyCode AS baseCurrencyCode, IsActive AS isActive
      FROM core.Companies
      WHERE (@TenantID IS NULL OR TenantID = @TenantID)
      ORDER BY CompanyCode;
    `);
    return result.recordset;
  }

  async listEmployees(filters = {}) {
    const request = scopedRequest(this.pool, filters)
      .input("StatusCode", sql.NVarChar(32), filters.statusCode || null)
      .input("Search", sql.NVarChar(120), filters.search ? `%${filters.search}%` : null);
    const result = await request.query(`
      SELECT EmployeeID AS employeeId, TenantID AS tenantId, CompanyID AS companyId, EmployeeNumber AS employeeNumber,
             DisplayName AS displayName, LegalName AS legalName, WorkEmail AS workEmail, Department AS department,
             JobTitle AS jobTitle, EmploymentType AS employmentType, StatusCode AS statusCode,
             CONVERT(char(10), HireDate, 23) AS hireDate,
             CONVERT(char(10), TerminationDate, 23) AS terminationDate,
             CreatedAtUtc AS createdAtUtc, UpdatedAtUtc AS updatedAtUtc
      FROM core.Employees
      WHERE (@TenantID IS NULL OR TenantID = @TenantID)
        AND (@CompanyID IS NULL OR CompanyID = @CompanyID)
        AND (@StatusCode IS NULL OR StatusCode = @StatusCode)
        AND (@Search IS NULL OR EmployeeNumber LIKE @Search OR DisplayName LIKE @Search OR Department LIKE @Search OR JobTitle LIKE @Search)
      ORDER BY EmployeeNumber;
    `);
    return result.recordset;
  }

  async createEmployee(input) {
    const employee = normalizeEmployee(input);
    await assertKnownTenantCompany(this.pool, employee.tenantId, employee.companyId);
    const id = sqlUuid();
    try {
      await this.pool.request()
        .input("EmployeeID", sql.UniqueIdentifier, id)
        .input("TenantID", sql.UniqueIdentifier, employee.tenantId)
        .input("CompanyID", sql.UniqueIdentifier, employee.companyId)
        .input("EmployeeNumber", sql.NVarChar(60), employee.employeeNumber)
        .input("DisplayName", sql.NVarChar(180), employee.displayName)
        .input("LegalName", sql.NVarChar(180), employee.legalName)
        .input("WorkEmail", sql.NVarChar(254), employee.workEmail)
        .input("Department", sql.NVarChar(120), employee.department)
        .input("JobTitle", sql.NVarChar(120), employee.jobTitle)
        .input("EmploymentType", sql.NVarChar(40), employee.employmentType)
        .input("StatusCode", sql.NVarChar(32), employee.statusCode)
        .input("HireDate", sql.Date, employee.hireDate)
        .input("TerminationDate", sql.Date, employee.terminationDate)
        .query(`
          INSERT INTO core.Employees
            (EmployeeID, TenantID, CompanyID, EmployeeNumber, DisplayName, LegalName, WorkEmail, Department, JobTitle, EmploymentType, StatusCode, HireDate, TerminationDate)
          VALUES
            (@EmployeeID, @TenantID, @CompanyID, @EmployeeNumber, @DisplayName, @LegalName, @WorkEmail, @Department, @JobTitle, @EmploymentType, @StatusCode, @HireDate, @TerminationDate);
        `);
    } catch (error) {
      if (error.number === 2601 || error.number === 2627) problem("EMPLOYEE_DUPLICATE", 409, "Employee number already exists for this tenant and company.");
      throw error;
    }
    return (await this.listEmployees({ tenantId: employee.tenantId, companyId: employee.companyId, search: employee.employeeNumber }))[0];
  }

  async listPolicies(filters = {}) {
    const result = await scopedRequest(this.pool, filters).query(`
      SELECT PolicyID AS policyId, TenantID AS tenantId, CompanyID AS companyId, PolicyCode AS policyCode, PolicyName AS policyName,
             AccrualCadence AS accrualCadence, MaxPayoutAmount AS maxPayoutAmount, CurrencyCode AS currencyCode,
             CONVERT(char(10), EffectiveFrom, 23) AS effectiveFrom, CONVERT(char(10), EffectiveTo, 23) AS effectiveTo, IsActive AS isActive
      FROM core.AirfareEntitlementPolicies
      WHERE (@TenantID IS NULL OR TenantID = @TenantID) AND (@CompanyID IS NULL OR CompanyID = @CompanyID)
      ORDER BY PolicyCode;
    `);
    return result.recordset;
  }

  async listOpeningSeeds(filters = {}) {
    const result = await scopedRequest(this.pool, filters).query(`
      SELECT EntitlementEventID AS seedId, TenantID AS tenantId, CompanyID AS companyId, EmployeeID AS employeeId,
             CONVERT(char(10), EventDate, 23) AS seedDate, Amount AS amount, CAST(NULL AS decimal(12,2)) AS days, SourceReference AS sourceReference
      FROM core.AirfareEntitlementEvents
      WHERE EventType = N'seed'
        AND (@TenantID IS NULL OR TenantID = @TenantID)
        AND (@CompanyID IS NULL OR CompanyID = @CompanyID)
        AND (@EmployeeID IS NULL OR EmployeeID = @EmployeeID)
      ORDER BY EventDate DESC;
    `);
    return result.recordset;
  }

  async createOpeningSeed(input) {
    const base = await scopedInput(this.pool, input);
    requireIso(input.seedDate, "seedDate");
    const amount = nonNegative(input.amount, "amount");
    await this.pool.request()
      .input("TenantID", sql.UniqueIdentifier, base.tenantId)
      .input("CompanyID", sql.UniqueIdentifier, base.companyId)
      .input("EmployeeID", sql.UniqueIdentifier, base.employeeId)
      .input("EventDate", sql.Date, input.seedDate)
      .input("Amount", sql.Decimal(12, 2), amount)
      .input("SourceReference", sql.NVarChar(120), input.sourceReference || "opening-seed")
      .query(`
        INSERT INTO core.AirfareEntitlementEvents (TenantID, CompanyID, EmployeeID, EventDate, EventType, Amount, SourceReference)
        VALUES (@TenantID, @CompanyID, @EmployeeID, @EventDate, N'seed', @Amount, @SourceReference);
      `);
    return { ...base, seedDate: input.seedDate, amount, days: Number(input.days || 0), sourceReference: input.sourceReference || "opening-seed" };
  }

  async listAllocations(filters = {}) {
    const result = await scopedRequest(this.pool, filters).query(`
      SELECT AllocationID AS allocationId, TenantID AS tenantId, CompanyID AS companyId, EmployeeID AS employeeId,
             CONVERT(char(10), AllocationDate, 23) AS allocationDate,
             TicketCost AS ticketCost, EntitlementApplied AS entitlementApplied, CompanyPaid AS companyPaid,
             StatusCode AS statusCode, SourceReference AS sourceReference
      FROM core.AirfareAllocations
      WHERE StatusCode <> N'cancelled'
        AND (@TenantID IS NULL OR TenantID = @TenantID)
        AND (@CompanyID IS NULL OR CompanyID = @CompanyID)
        AND (@EmployeeID IS NULL OR EmployeeID = @EmployeeID)
      ORDER BY AllocationDate DESC;
    `);
    return result.recordset.map((row) => ({
      ...row,
      ticketCost: money(row.ticketCost),
      entitlementApplied: money(row.entitlementApplied),
      companyPaid: money(row.companyPaid)
    }));
  }

  async createAllocation(input) {
    const base = await scopedInput(this.pool, input);
    requireIso(input.allocationDate, "allocationDate");
    const ticketCost = nonNegative(input.ticketCost, "ticketCost");
    const balance = (await this.entitlementBalance({ ...base, asOfDate: input.allocationDate }))[0]?.balanceAmount || 0;
    const entitlementApplied = money(Math.min(ticketCost, balance));
    const companyPaid = money(Math.max(0, ticketCost - entitlementApplied));
    const transaction = new sql.Transaction(this.pool);
    await transaction.begin();
    try {
      const eventResult = await new sql.Request(transaction)
        .input("TenantID", sql.UniqueIdentifier, base.tenantId)
        .input("CompanyID", sql.UniqueIdentifier, base.companyId)
        .input("EmployeeID", sql.UniqueIdentifier, base.employeeId)
        .input("EventDate", sql.Date, input.allocationDate)
        .input("Amount", sql.Decimal(12, 2), entitlementApplied)
        .input("SourceReference", sql.NVarChar(120), input.sourceReference || "allocation")
        .query(`
          INSERT INTO core.AirfareEntitlementEvents (TenantID, CompanyID, EmployeeID, EventDate, EventType, Amount, SourceReference)
          OUTPUT INSERTED.EntitlementEventID AS EntitlementEventID
          VALUES (@TenantID, @CompanyID, @EmployeeID, @EventDate, N'usage', @Amount, @SourceReference);
        `);
      const allocationId = sqlUuid();
      await new sql.Request(transaction)
        .input("AllocationID", sql.UniqueIdentifier, allocationId)
        .input("TenantID", sql.UniqueIdentifier, base.tenantId)
        .input("CompanyID", sql.UniqueIdentifier, base.companyId)
        .input("EmployeeID", sql.UniqueIdentifier, base.employeeId)
        .input("AllocationDate", sql.Date, input.allocationDate)
        .input("TicketCost", sql.Decimal(12, 2), ticketCost)
        .input("EntitlementApplied", sql.Decimal(12, 2), entitlementApplied)
        .input("CompanyPaid", sql.Decimal(12, 2), companyPaid)
        .input("SourceReference", sql.NVarChar(120), input.sourceReference || "allocation")
        .input("EntitlementEventID", sql.BigInt, eventResult.recordset[0].EntitlementEventID)
        .query(`
          INSERT INTO core.AirfareAllocations
            (AllocationID, TenantID, CompanyID, EmployeeID, AllocationDate, TicketCost, EntitlementApplied, CompanyPaid, SourceReference, EntitlementEventID)
          VALUES
            (@AllocationID, @TenantID, @CompanyID, @EmployeeID, @AllocationDate, @TicketCost, @EntitlementApplied, @CompanyPaid, @SourceReference, @EntitlementEventID);
        `);
      await transaction.commit();
      return { ...base, allocationId, allocationDate: input.allocationDate, ticketCost, entitlementApplied, companyPaid, statusCode: "posted" };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async listLoans(filters = {}) {
    const result = await scopedRequest(this.pool, filters).query(`
      SELECT LoanID AS loanId, TenantID AS tenantId, CompanyID AS companyId, EmployeeID AS employeeId,
             PrincipalAmount AS principalAmount, EmiAmount AS emiAmount, CONVERT(char(10), StartDate, 23) AS startDate, StatusCode AS statusCode
      FROM core.EmployeeLoans
      WHERE (@TenantID IS NULL OR TenantID = @TenantID)
        AND (@CompanyID IS NULL OR CompanyID = @CompanyID)
        AND (@EmployeeID IS NULL OR EmployeeID = @EmployeeID)
      ORDER BY StartDate DESC;
    `);
    return result.recordset;
  }

  async createLoan(input) {
    const base = await scopedInput(this.pool, input);
    requireIso(input.startDate, "startDate");
    const principalAmount = nonNegative(input.principalAmount, "principalAmount");
    const emiAmount = nonNegative(input.emiAmount, "emiAmount");
    const loanId = sqlUuid();
    await this.pool.request()
      .input("LoanID", sql.UniqueIdentifier, loanId)
      .input("TenantID", sql.UniqueIdentifier, base.tenantId)
      .input("CompanyID", sql.UniqueIdentifier, base.companyId)
      .input("EmployeeID", sql.UniqueIdentifier, base.employeeId)
      .input("PrincipalAmount", sql.Decimal(12, 2), principalAmount)
      .input("EmiAmount", sql.Decimal(12, 2), emiAmount)
      .input("StartDate", sql.Date, input.startDate)
      .query(`
        INSERT INTO core.EmployeeLoans (LoanID, TenantID, CompanyID, EmployeeID, PrincipalAmount, EmiAmount, StartDate)
        VALUES (@LoanID, @TenantID, @CompanyID, @EmployeeID, @PrincipalAmount, @EmiAmount, @StartDate);
      `);
    return { ...base, loanId, principalAmount, emiAmount, startDate: input.startDate, statusCode: "active" };
  }

  async loanSummary(filters = {}) {
    const loans = await this.listLoans(filters);
    return {
      totalLoans: loans.length,
      activeLoans: loans.filter((loan) => loan.statusCode === "active").length,
      settledLoans: loans.filter((loan) => loan.statusCode === "settled").length,
      principalAmount: money(loans.reduce((sum, loan) => sum + Number(loan.principalAmount || 0), 0)),
      monthlyEmi: money(loans.filter((loan) => loan.statusCode === "active").reduce((sum, loan) => sum + Number(loan.emiAmount || 0), 0))
    };
  }

  async entitlementBalance({ tenantId, companyId, employeeId, asOfDate }) {
    requireIso(asOfDate, "asOfDate");
    const result = await scopedRequest(this.pool, { tenantId, companyId, employeeId })
      .input("AsOfDate", sql.Date, asOfDate)
      .query(`
        SELECT e.EmployeeID AS employeeId, e.EmployeeNumber AS employeeNumber, e.DisplayName AS displayName,
               @AsOfDate AS asOfDate,
               CAST(COALESCE(SUM(CASE WHEN ev.EventType IN (N'seed', N'accrual', N'adjustment', N'reversal') THEN ev.Amount ELSE 0 END), 0) AS decimal(12,2)) AS earnedAmount,
               CAST(COALESCE(SUM(CASE WHEN ev.EventType = N'usage' THEN ev.Amount ELSE 0 END), 0) AS decimal(12,2)) AS usedAmount
        FROM core.Employees e
        LEFT JOIN core.AirfareEntitlementEvents ev
          ON ev.EmployeeID = e.EmployeeID
         AND ev.EventDate <= @AsOfDate
        WHERE (@TenantID IS NULL OR e.TenantID = @TenantID)
          AND (@CompanyID IS NULL OR e.CompanyID = @CompanyID)
          AND (@EmployeeID IS NULL OR e.EmployeeID = @EmployeeID)
        GROUP BY e.EmployeeID, e.EmployeeNumber, e.DisplayName
        ORDER BY e.EmployeeNumber;
      `);
    return result.recordset.map((row) => ({
      ...row,
      asOfDate,
      earnedAmount: money(row.earnedAmount),
      usedAmount: money(row.usedAmount),
      balanceAmount: money(Math.max(0, Number(row.earnedAmount || 0) - Number(row.usedAmount || 0))),
      currencyCode: "BHD"
    }));
  }

  async moduleSummary({ tenantId, companyId, asOfDate }) {
    const [employees, balances, allocations, seeds, loans] = await Promise.all([
      this.listEmployees({ tenantId, companyId }),
      this.entitlementBalance({ tenantId, companyId, asOfDate }),
      this.listAllocations({ tenantId, companyId }),
      this.listOpeningSeeds({ tenantId, companyId }),
      this.loanSummary({ tenantId, companyId })
    ]);
    return {
      asOfDate,
      repository: this.repository,
      employees: { total: employees.length, active: employees.filter((employee) => employee.statusCode === "active").length },
      entitlement: {
        totalBalance: money(balances.reduce((sum, row) => sum + Number(row.balanceAmount || 0), 0)),
        totalUsed: money(balances.reduce((sum, row) => sum + Number(row.usedAmount || 0), 0))
      },
      allocations: { total: allocations.length },
      openingSeeds: { total: seeds.length },
      loans
    };
  }
}

function readConfig(overrides) {
  const rawServer = overrides.server || process.env.DB_SERVER || "localhost";
  const parsed = parseServerName(rawServer);
  return {
    server: parsed.server,
    instanceName: overrides.instanceName || process.env.DB_INSTANCE || parsed.instanceName || null,
    port: overrides.port || process.env.DB_PORT ? Number(overrides.port || process.env.DB_PORT) : (parsed.instanceName ? null : 1433),
    database: overrides.database || process.env.DB_NAME || "AtlasGreenfieldCore",
    user: overrides.user || process.env.DB_USER || "sa",
    password: overrides.password || process.env.DB_PASSWORD || "",
    encrypt: String(overrides.encrypt ?? process.env.DB_ENCRYPT ?? "false") === "true",
    trustServerCertificate: String(overrides.trustServerCertificate ?? process.env.DB_TRUST_SERVER_CERTIFICATE ?? "true") !== "false"
  };
}

async function ensureDatabase(config) {
  validateDatabaseName(config.database);
  const master = await new sql.ConnectionPool(poolConfig("master", config)).connect();
  try {
    await master.request()
      .input("DatabaseName", sql.NVarChar(128), config.database)
      .query(`IF DB_ID(@DatabaseName) IS NULL EXEC(N'CREATE DATABASE ${quoteIdentifier(config.database)}');`);
  } finally {
    await master.close();
  }
}

async function applyCoreSchema(pool) {
  const schemaText = readFileSync(resolve(root, "schema", "mssql", "001_foundation.sql"), "utf8");
  for (const batch of schemaText.split(/^\s*GO\s*$/gim).map((part) => part.trim()).filter(Boolean)) {
    await pool.request().batch(batch);
  }
}

async function seedCoreData(pool) {
  const tenant = defaultSeed.tenants[0];
  const company = defaultSeed.companies[0];
  const employee = defaultSeed.employees[0];
  const policy = defaultSeed.policies[0];
  const event = defaultSeed.entitlementEvents[0];
  await pool.request()
    .input("TenantID", sql.UniqueIdentifier, tenant.tenantId)
    .input("TenantCode", sql.NVarChar(40), tenant.tenantCode)
    .input("TenantName", sql.NVarChar(160), tenant.tenantName)
    .query(`IF NOT EXISTS (SELECT 1 FROM core.Tenants WHERE TenantID = @TenantID) INSERT INTO core.Tenants (TenantID, TenantCode, TenantName) VALUES (@TenantID, @TenantCode, @TenantName);`);
  await pool.request()
    .input("TenantID", sql.UniqueIdentifier, tenant.tenantId)
    .input("LogicalName", sql.NVarChar(80), "primary")
    .input("SqlServerName", sql.NVarChar(160), "configured")
    .input("DatabaseName", sql.NVarChar(128), "AtlasGreenfieldCore")
    .query(`IF NOT EXISTS (SELECT 1 FROM core.TenantDatabases WHERE TenantID = @TenantID AND LogicalName = @LogicalName) INSERT INTO core.TenantDatabases (TenantID, LogicalName, SqlServerName, DatabaseName, IsPrimary) VALUES (@TenantID, @LogicalName, @SqlServerName, @DatabaseName, 1);`);
  await pool.request()
    .input("CompanyID", sql.UniqueIdentifier, company.companyId)
    .input("TenantID", sql.UniqueIdentifier, company.tenantId)
    .input("CompanyCode", sql.NVarChar(40), company.companyCode)
    .input("CompanyName", sql.NVarChar(180), company.companyName)
    .input("BaseCurrencyCode", sql.Char(3), company.baseCurrencyCode)
    .query(`IF NOT EXISTS (SELECT 1 FROM core.Companies WHERE CompanyID = @CompanyID) INSERT INTO core.Companies (CompanyID, TenantID, CompanyCode, CompanyName, BaseCurrencyCode) VALUES (@CompanyID, @TenantID, @CompanyCode, @CompanyName, @BaseCurrencyCode);`);
  await pool.request()
    .input("EmployeeID", sql.UniqueIdentifier, employee.employeeId)
    .input("TenantID", sql.UniqueIdentifier, employee.tenantId)
    .input("CompanyID", sql.UniqueIdentifier, employee.companyId)
    .input("EmployeeNumber", sql.NVarChar(60), employee.employeeNumber)
    .input("DisplayName", sql.NVarChar(180), employee.displayName)
    .input("WorkEmail", sql.NVarChar(254), employee.workEmail)
    .input("Department", sql.NVarChar(120), employee.department)
    .input("JobTitle", sql.NVarChar(120), employee.jobTitle)
    .input("EmploymentType", sql.NVarChar(40), employee.employmentType)
    .input("StatusCode", sql.NVarChar(32), employee.statusCode)
    .input("HireDate", sql.Date, employee.hireDate)
    .query(`IF NOT EXISTS (SELECT 1 FROM core.Employees WHERE EmployeeID = @EmployeeID) INSERT INTO core.Employees (EmployeeID, TenantID, CompanyID, EmployeeNumber, DisplayName, WorkEmail, Department, JobTitle, EmploymentType, StatusCode, HireDate) VALUES (@EmployeeID, @TenantID, @CompanyID, @EmployeeNumber, @DisplayName, @WorkEmail, @Department, @JobTitle, @EmploymentType, @StatusCode, @HireDate);`);
  await pool.request()
    .input("PolicyID", sql.UniqueIdentifier, policy.policyId)
    .input("TenantID", sql.UniqueIdentifier, policy.tenantId)
    .input("CompanyID", sql.UniqueIdentifier, policy.companyId)
    .input("PolicyCode", sql.NVarChar(60), policy.policyCode)
    .input("PolicyName", sql.NVarChar(160), policy.policyName)
    .input("AccrualCadence", sql.NVarChar(40), policy.accrualCadence)
    .input("MaxPayoutAmount", sql.Decimal(12, 2), policy.maxPayoutAmount)
    .input("EffectiveFrom", sql.Date, policy.effectiveFrom)
    .query(`IF NOT EXISTS (SELECT 1 FROM core.AirfareEntitlementPolicies WHERE PolicyID = @PolicyID) INSERT INTO core.AirfareEntitlementPolicies (PolicyID, TenantID, CompanyID, PolicyCode, PolicyName, AccrualCadence, MaxPayoutAmount, EffectiveFrom) VALUES (@PolicyID, @TenantID, @CompanyID, @PolicyCode, @PolicyName, @AccrualCadence, @MaxPayoutAmount, @EffectiveFrom);`);
  await pool.request()
    .input("TenantID", sql.UniqueIdentifier, event.tenantId)
    .input("CompanyID", sql.UniqueIdentifier, event.companyId)
    .input("EmployeeID", sql.UniqueIdentifier, event.employeeId)
    .input("EventDate", sql.Date, event.eventDate)
    .input("Amount", sql.Decimal(12, 2), event.amount)
    .input("SourceReference", sql.NVarChar(120), event.sourceReference)
    .query(`IF NOT EXISTS (SELECT 1 FROM core.AirfareEntitlementEvents WHERE EmployeeID = @EmployeeID AND EventType = N'seed' AND SourceReference = @SourceReference) INSERT INTO core.AirfareEntitlementEvents (TenantID, CompanyID, EmployeeID, EventDate, EventType, Amount, SourceReference) VALUES (@TenantID, @CompanyID, @EmployeeID, @EventDate, N'seed', @Amount, @SourceReference);`);
}

function poolConfig(database, config) {
  const base = {
    server: config.server,
    database,
    user: config.user,
    password: config.password,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
      instanceName: config.instanceName || undefined
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
  };
  if (config.port) base.port = config.port;
  return base;
}

function parseServerName(serverName) {
  const text = String(serverName || "localhost").trim();
  const slash = text.indexOf("\\");
  if (slash === -1) return { server: text, instanceName: null };
  return { server: text.slice(0, slash), instanceName: text.slice(slash + 1) };
}

function scopedRequest(pool, filters = {}) {
  return pool.request()
    .input("TenantID", sql.UniqueIdentifier, filters.tenantId || null)
    .input("CompanyID", sql.UniqueIdentifier, filters.companyId || null)
    .input("EmployeeID", sql.UniqueIdentifier, filters.employeeId || null);
}

async function scopedInput(pool, input) {
  const tenantId = String(input?.tenantId || "").trim();
  const companyId = String(input?.companyId || "").trim();
  const employeeId = String(input?.employeeId || "").trim();
  await assertKnownTenantCompany(pool, tenantId, companyId);
  const result = await pool.request()
    .input("TenantID", sql.UniqueIdentifier, tenantId)
    .input("CompanyID", sql.UniqueIdentifier, companyId)
    .input("EmployeeID", sql.UniqueIdentifier, employeeId)
    .query(`SELECT TOP 1 EmployeeID FROM core.Employees WHERE TenantID = @TenantID AND CompanyID = @CompanyID AND EmployeeID = @EmployeeID;`);
  if (!result.recordset.length) problem("EMPLOYEE_NOT_FOUND", 422, "employeeId does not exist for tenantId/companyId.");
  return { ...input, tenantId, companyId, employeeId };
}

async function assertKnownTenantCompany(pool, tenantId, companyId) {
  const result = await pool.request()
    .input("TenantID", sql.UniqueIdentifier, tenantId)
    .input("CompanyID", sql.UniqueIdentifier, companyId)
    .query(`
      SELECT
        CASE WHEN EXISTS (SELECT 1 FROM core.Tenants WHERE TenantID = @TenantID) THEN 1 ELSE 0 END AS HasTenant,
        CASE WHEN EXISTS (SELECT 1 FROM core.Companies WHERE TenantID = @TenantID AND CompanyID = @CompanyID) THEN 1 ELSE 0 END AS HasCompany;
    `);
  if (!result.recordset[0]?.HasTenant) problem("TENANT_NOT_FOUND", 422, "tenantId does not exist.");
  if (!result.recordset[0]?.HasCompany) problem("COMPANY_NOT_FOUND", 422, "companyId does not exist for tenantId.");
}

function requireIso(value, fieldName) {
  if (!isIsoDate(String(value || ""))) problem("INVALID_DATE", 422, `${fieldName} must be YYYY-MM-DD.`);
}

function nonNegative(value, fieldName) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) problem("INVALID_AMOUNT", 422, `${fieldName} must be a non-negative number.`);
  return money(amount);
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function sqlUuid() {
  return randomUUID();
}

function validateDatabaseName(name) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(name)) problem("INVALID_DATABASE_NAME", 400, "DB_NAME is invalid.");
}

function quoteIdentifier(name) {
  validateDatabaseName(name);
  return `[${name.replace(/]/g, "]]")}]`;
}

function problem(code, statusCode, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}
