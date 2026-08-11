import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGreenfieldStore, defaultSeed } from "../src/store/greenfieldStore.js";
import { isIsoDate, normalizeEmployee } from "../src/domain/employees.js";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const server = readFileSync(join(root, "src", "server.js"), "utf8");
const page = readFileSync(join(root, "web", "index.html"), "utf8");
const appJs = readFileSync(join(root, "web", "app.js"), "utf8");
const schema = readFileSync(join(root, "schema", "mssql", "001_foundation.sql"), "utf8");

const baseline = {
  oldSystemModules: ["employees", "companies", "openingSeeds", "entitlements", "allocations", "loans"],
  rejectedOldPatterns: ["Year End", "Opening Balance register", "Migration Debug", "Atlasairfare010", "Atlasairfare3356"]
};

assert.equal(isIsoDate("2026-12-31"), true, "valid date must pass");
assert.equal(isIsoDate("2026-02-31"), false, "impossible date must fail");
assert.throws(
  () => normalizeEmployee({ tenantId: "t", companyId: "c", employeeNumber: "E1", displayName: "Bad Date", hireDate: "31/12/2026" }),
  /hireDate must be YYYY-MM-DD/,
  "employee dates must be explicit ISO dates"
);

const tempDir = mkdtempSync(join(tmpdir(), "atlas-greenfield-"));
const dataFile = join(tempDir, "store.json");
try {
  const store = createGreenfieldStore({ dataFile });
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const companyId = "22222222-2222-4222-8222-222222222222";
  const employee = store.createEmployee({
    tenantId,
    companyId,
    employeeNumber: "GF-9001",
    displayName: "Aisha Noor",
    hireDate: "2026-01-15",
    department: "Finance",
    jobTitle: "Payroll Officer",
    workEmail: "AISHA.NOOR@example.com"
  });

  assert.equal(employee.workEmail, "aisha.noor@example.com", "email normalization must be deterministic");
  assert.equal(store.listEmployees({ tenantId, companyId }).some((row) => row.employeeNumber === "GF-9001"), true, "employee must list inside tenant/company");
  assert.throws(
    () => store.createEmployee({ tenantId, companyId, employeeNumber: "GF-9001", displayName: "Duplicate", hireDate: "2026-02-01" }),
    /already exists/,
    "employee number must be unique per tenant/company"
  );

  const seed = store.createOpeningSeed({ tenantId, companyId, employeeId: employee.employeeId, seedDate: "2026-01-15", amount: 150, days: 60 });
  assert.equal(seed.amount, 150, "opening seed evidence must be stored as evidence");

  const beforeAllocation = store.entitlementBalance({ tenantId, companyId, employeeId: employee.employeeId, asOfDate: "2026-06-01" })[0];
  assert.equal(beforeAllocation.balanceAmount, 150, "seed evidence must contribute to continuous entitlement balance");

  const allocation = store.createAllocation({ tenantId, companyId, employeeId: employee.employeeId, allocationDate: "2026-06-01", ticketCost: 90 });
  assert.equal(allocation.entitlementApplied, 90, "allocation must consume available entitlement before company paid amount");
  assert.equal(allocation.companyPaid, 0, "company paid is zero when entitlement covers the ticket");

  const afterAllocation = store.entitlementBalance({ tenantId, companyId, employeeId: employee.employeeId, asOfDate: "2026-12-31" })[0];
  assert.equal(afterAllocation.balanceAmount, 60, "entitlement balance must be event-derived as of date");

  const loan = store.createLoan({ tenantId, companyId, employeeId: employee.employeeId, principalAmount: 120, emiAmount: 20, startDate: "2026-07-01" });
  assert.equal(loan.statusCode, "active", "new loan must enter active recovery");
  assert.equal(store.loanSummary({ tenantId, companyId }).monthlyEmi, 20, "loan summary must include EMI exposure");

  const persisted = createGreenfieldStore({ dataFile });
  assert.equal(persisted.listEmployees({ tenantId, companyId }).some((row) => row.employeeNumber === "GF-9001"), true, "data must survive store restart");
  assert.equal(persisted.listAllocations({ tenantId, companyId }).length, 1, "allocations must survive store restart");
  assert.equal(persisted.listLoans({ tenantId, companyId }).length, 1, "loans must survive store restart");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

for (const moduleName of baseline.oldSystemModules) {
  assert.match(server, new RegExp(moduleName === "openingSeeds" ? "opening-seeds" : moduleName.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), "i"), `new server must cover ${moduleName}`);
}

assert.match(schema, /CREATE SCHEMA core/i, "schema must own its namespace");
assert.match(schema, /core\.Tenants/i, "tenant table is mandatory");
assert.match(schema, /core\.TenantDatabases/i, "database routing table is mandatory");
assert.match(schema, /core\.Companies/i, "company table is mandatory");
assert.match(schema, /core\.Employees/i, "employee table is mandatory");
assert.match(schema, /UQ_Employees_TenantCompanyNumber/i, "employee number uniqueness must be tenant/company scoped");
assert.match(schema, /core\.AirfareEntitlementPolicies/i, "entitlement policies must be modeled separately");
assert.match(schema, /core\.AirfareEntitlementEvents/i, "entitlement history must be event-based");
assert.match(schema, /core\.EmployeeLoans/i, "loan and EMI management must reference employee master");
assert.ok(schema.indexOf("CREATE SCHEMA core") < schema.indexOf("CREATE TABLE core.Employees"), "core schema must be created before core tables");
assert.ok(schema.indexOf("CREATE TABLE core.Employees") < schema.indexOf("CREATE TABLE core.EmployeeStatusEvents"), "employee status events must deploy after employee master");

for (const rejected of baseline.rejectedOldPatterns) {
  const pattern = new RegExp(rejected, "i");
  assert.doesNotMatch(server, pattern, `server must not leak ${rejected}`);
  assert.doesNotMatch(page, pattern, `page must not leak ${rejected}`);
  assert.doesNotMatch(appJs, pattern, `app JS must not leak ${rejected}`);
  assert.doesNotMatch(schema, pattern, `schema must not leak ${rejected}`);
}

assert.doesNotMatch(server, /from\s+["']\.\.\/\.\.\/server\.js|atlas-hcm-next/, "greenfield server must not import old app/runtime");
assert.match(page, /No old runtime\. No double system\./, "UI must state the new-system boundary");

console.log("GREENFIELD CORE REQUIREMENT AND COMPARISON TESTS PASSED");
