import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMemoryStore, defaultSeed } from "../src/store/memoryStore.js";
import { isIsoDate, normalizeEmployee } from "../src/domain/employees.js";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const server = readFileSync(join(root, "src", "server.js"), "utf8");
const page = readFileSync(join(root, "web", "index.html"), "utf8");
const schema = readFileSync(join(root, "schema", "mssql", "001_foundation.sql"), "utf8");

assert.equal(isIsoDate("2026-12-31"), true, "valid date must pass");
assert.equal(isIsoDate("2026-02-31"), false, "impossible date must fail");

assert.throws(
  () => normalizeEmployee({ tenantId: "t", companyId: "c", employeeNumber: "E1", displayName: "Bad Date", hireDate: "31/12/2026" }),
  /hireDate must be YYYY-MM-DD/,
  "employee dates must be explicit ISO dates"
);

const store = createMemoryStore(defaultSeed);
const employee = store.createEmployee({
  tenantId: "tenant-atlas-demo",
  companyId: "company-atlas-airfare",
  employeeNumber: "0001",
  displayName: "Aisha Noor",
  hireDate: "2026-01-15",
  department: "Finance",
  jobTitle: "Payroll Officer",
  workEmail: "AISHA.NOOR@example.com"
});

assert.equal(employee.workEmail, "aisha.noor@example.com", "email normalization must be deterministic");
assert.equal(store.listEmployees({ tenantId: "tenant-atlas-demo", companyId: "company-atlas-airfare" }).length, 1, "employee must list inside its tenant/company");

assert.throws(
  () => store.createEmployee({
    tenantId: "tenant-atlas-demo",
    companyId: "company-atlas-airfare",
    employeeNumber: "0001",
    displayName: "Duplicate",
    hireDate: "2026-02-01"
  }),
  /already exists/,
  "employee number must be unique per tenant/company"
);

assert.throws(
  () => store.createEmployee({
    tenantId: "missing",
    companyId: "company-atlas-airfare",
    employeeNumber: "0002",
    displayName: "No Tenant",
    hireDate: "2026-02-01"
  }),
  /tenantId does not exist/,
  "employee writes must reject unknown tenants"
);

assert.match(schema, /CREATE SCHEMA core/i, "schema must own its namespace");
assert.match(schema, /core\.Tenants/i, "tenant table is mandatory");
assert.match(schema, /core\.TenantDatabases/i, "database routing table is mandatory");
assert.match(schema, /core\.Companies/i, "company table is mandatory");
assert.match(schema, /core\.Employees/i, "employee table is mandatory");
assert.match(schema, /UQ_Employees_TenantCompanyNumber/i, "employee number uniqueness must be tenant/company scoped");
assert.match(schema, /core\.AirfareEntitlementPolicies/i, "entitlement policies must be modeled separately");
assert.match(schema, /core\.AirfareEntitlementEvents/i, "entitlement history must be event-based");
assert.match(schema, /core\.EmployeeLoans/i, "loan and EMI management must reference employee master");
assert.ok(
  schema.indexOf("CREATE SCHEMA core") < schema.indexOf("CREATE TABLE core.Employees"),
  "core schema must be created before core tables"
);
assert.ok(
  schema.indexOf("CREATE TABLE core.Employees") < schema.indexOf("CREATE TABLE core.EmployeeStatusEvents"),
  "employee status events must be created after employee master so FK deployment is valid"
);

assert.doesNotMatch(server, /from\s+["']\.\.\/\.\.\/server\.js|atlas-hcm-next|Atlasairfare010|Atlasairfare3356/, "greenfield server must not import old app/runtime/database defaults");
assert.doesNotMatch(page, /Year End|Update next year|Opening Balance register|Migration Debug/, "greenfield UI must not leak old screen labels");
assert.doesNotMatch(schema, /Atlasairfare010|Atlasairfare3356|OpeningBalances|Allocations|YearEnd/i, "greenfield schema must not merge old tables or defaults");

console.log("GREENFIELD EMPLOYEES REQUIREMENT TESTS PASSED");
