import { randomUUID } from "node:crypto";
import { employeeBusinessKey, normalizeEmployee } from "../domain/employees.js";

export function createMemoryStore(seed = {}) {
  const tenants = new Map();
  const companies = new Map();
  const employees = new Map();
  const employeeKeys = new Map();

  for (const tenant of seed.tenants || []) tenants.set(tenant.tenantId, { ...tenant });
  for (const company of seed.companies || []) companies.set(company.companyId, { ...company });

  return {
    listTenants() {
      return Array.from(tenants.values());
    },
    listCompanies(tenantId) {
      return Array.from(companies.values()).filter((company) => !tenantId || company.tenantId === tenantId);
    },
    listEmployees({ tenantId, companyId, statusCode, search } = {}) {
      const query = String(search || "").trim().toLowerCase();
      return Array.from(employees.values())
        .filter((employee) => !tenantId || employee.tenantId === tenantId)
        .filter((employee) => !companyId || employee.companyId === companyId)
        .filter((employee) => !statusCode || employee.statusCode === statusCode)
        .filter((employee) => {
          if (!query) return true;
          return `${employee.employeeNumber} ${employee.displayName} ${employee.department || ""} ${employee.jobTitle || ""}`.toLowerCase().includes(query);
        })
        .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
    },
    createEmployee(input) {
      const normalized = normalizeEmployee(input);
      assertKnownTenantCompany(normalized.tenantId, normalized.companyId);
      const key = employeeBusinessKey(normalized);
      if (employeeKeys.has(key)) {
        const error = new Error("Employee number already exists for this tenant and company.");
        error.code = "EMPLOYEE_DUPLICATE";
        error.statusCode = 409;
        throw error;
      }
      const employee = {
        employeeId: randomUUID(),
        createdAtUtc: new Date().toISOString(),
        ...normalized
      };
      employees.set(employee.employeeId, employee);
      employeeKeys.set(key, employee.employeeId);
      return employee;
    },
    getEmployee(employeeId) {
      return employees.get(employeeId) || null;
    }
  };

  function assertKnownTenantCompany(tenantId, companyId) {
    if (!tenants.has(tenantId)) {
      const error = new Error("tenantId does not exist.");
      error.code = "TENANT_NOT_FOUND";
      error.statusCode = 422;
      throw error;
    }
    const company = companies.get(companyId);
    if (!company || company.tenantId !== tenantId) {
      const error = new Error("companyId does not exist for tenantId.");
      error.code = "COMPANY_NOT_FOUND";
      error.statusCode = 422;
      throw error;
    }
  }
}

export const defaultSeed = {
  tenants: [
    {
      tenantId: "tenant-atlas-demo",
      tenantCode: "ATLAS",
      tenantName: "ATLAS Greenfield Tenant",
      databaseName: "AtlasGreenfieldCore"
    }
  ],
  companies: [
    {
      companyId: "company-atlas-airfare",
      tenantId: "tenant-atlas-demo",
      companyCode: "ATLAS-AIR",
      companyName: "ATLAS Airfare Company",
      baseCurrencyCode: "BHD"
    }
  ]
};
