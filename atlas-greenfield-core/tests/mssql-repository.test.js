import assert from "node:assert/strict";
import { createMssqlRepository } from "../src/store/mssqlRepository.js";

const enabled = String(process.env.ATLAS_GREENFIELD_MSSQL_TEST || "").toLowerCase() === "true";

if (!enabled) {
  console.log("MSSQL REPOSITORY TEST SKIPPED: set ATLAS_GREENFIELD_MSSQL_TEST=true to run against SQL Server.");
  process.exit(0);
}

const repo = await createMssqlRepository({
  server: process.env.DB_SERVER || "localhost",
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || `AtlasGreenfieldCoreTest`,
  user: process.env.DB_USER || "sa",
  password: process.env.DB_PASSWORD || ""
});

const tenantId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";

const snapshot = await repo.snapshot();
assert.equal(snapshot.repository, "mssql-core", "runtime repository must be MSSQL core");
assert.ok(snapshot.database, "database name must be reported");

const companies = await repo.listCompanies(tenantId);
assert.equal(companies.length >= 1, true, "seed company must exist");

const created = await repo.createEmployee({
  tenantId,
  companyId,
  employeeNumber: `GF-SQL-${Date.now()}`,
  displayName: "SQL Verified Employee",
  hireDate: "2026-01-01",
  department: "Validation",
  jobTitle: "Core Tester",
  workEmail: "SQL.Verified@example.com"
});
assert.equal(created.displayName, "SQL Verified Employee", "created employee must round-trip from SQL");

const seed = await repo.createOpeningSeed({
  tenantId,
  companyId,
  employeeId: created.employeeId,
  seedDate: "2026-01-01",
  amount: 150,
  sourceReference: `sql-test-seed-${Date.now()}`
});
assert.equal(seed.amount, 150, "opening seed must persist to SQL event ledger");

const before = (await repo.entitlementBalance({ tenantId, companyId, employeeId: created.employeeId, asOfDate: "2026-06-30" }))[0];
assert.equal(before.balanceAmount, 150, "continuous balance must derive from SQL events");

const allocation = await repo.createAllocation({
  tenantId,
  companyId,
  employeeId: created.employeeId,
  allocationDate: "2026-07-01",
  ticketCost: 75,
  sourceReference: `sql-test-allocation-${Date.now()}`
});
assert.equal(allocation.entitlementApplied, 75, "allocation must consume SQL entitlement");
assert.equal(allocation.companyPaid, 0, "company paid must be zero when entitlement covers cost");

const after = (await repo.entitlementBalance({ tenantId, companyId, employeeId: created.employeeId, asOfDate: "2026-12-31" }))[0];
assert.equal(after.balanceAmount, 75, "post-allocation SQL balance must be correct");

const loan = await repo.createLoan({
  tenantId,
  companyId,
  employeeId: created.employeeId,
  principalAmount: 300,
  emiAmount: 50,
  startDate: "2026-08-01"
});
assert.equal(loan.statusCode, "active", "SQL loan must enter active recovery");

const summary = await repo.moduleSummary({ tenantId, companyId, asOfDate: "2026-12-31" });
assert.equal(summary.repository, "mssql-core", "summary must identify MSSQL core");
assert.equal(summary.employees.active >= 1, true, "summary must see SQL employees");
assert.equal(summary.entitlement.totalBalance >= 75, true, "summary must include SQL entitlement balance");

console.log("MSSQL CORE REPOSITORY TEST PASSED");
