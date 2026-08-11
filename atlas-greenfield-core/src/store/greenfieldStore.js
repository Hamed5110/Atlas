import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { employeeBusinessKey, isIsoDate, normalizeEmployee } from "../domain/employees.js";

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
  ],
  employees: [
    {
      employeeId: "employee-greenfield-0001",
      tenantId: "tenant-atlas-demo",
      companyId: "company-atlas-airfare",
      employeeNumber: "GF-0001",
      displayName: "Greenfield Employee One",
      legalName: null,
      workEmail: "greenfield.one@example.com",
      department: "People Operations",
      jobTitle: "Payroll Specialist",
      employmentType: "full_time",
      statusCode: "active",
      hireDate: "2026-01-01",
      terminationDate: null,
      createdAtUtc: "2026-01-01T00:00:00.000Z",
      updatedAtUtc: "2026-01-01T00:00:00.000Z"
    }
  ],
  policies: [
    {
      policyId: "policy-airfare-default",
      tenantId: "tenant-atlas-demo",
      companyId: "company-atlas-airfare",
      policyCode: "AIRFARE-CONTINUOUS",
      policyName: "Continuous airfare entitlement",
      accrualCadence: "monthly",
      maxPayoutAmount: 150,
      currencyCode: "BHD",
      effectiveFrom: "2026-01-01",
      isActive: true
    }
  ],
  entitlementEvents: [
    {
      eventId: "event-seed-gf-0001",
      tenantId: "tenant-atlas-demo",
      companyId: "company-atlas-airfare",
      employeeId: "employee-greenfield-0001",
      eventDate: "2026-01-01",
      eventType: "seed",
      amount: 150,
      currencyCode: "BHD",
      sourceReference: "greenfield-seed"
    }
  ],
  allocations: [],
  loans: [],
  openingSeeds: [
    {
      seedId: "seed-gf-0001",
      tenantId: "tenant-atlas-demo",
      companyId: "company-atlas-airfare",
      employeeId: "employee-greenfield-0001",
      seedDate: "2026-01-01",
      amount: 150,
      days: 60,
      sourceReference: "initial evidence"
    }
  ]
};

export function createGreenfieldStore({ dataFile = null, seed = defaultSeed } = {}) {
  const state = loadState(dataFile, seed);
  ensureIndexes(state);

  return {
    dataFile,
    snapshot() {
      return structuredCloneSafe(state);
    },
    listTenants() {
      return [...state.tenants];
    },
    listCompanies(tenantId) {
      return state.companies.filter((company) => !tenantId || company.tenantId === tenantId);
    },
    listEmployees(filters = {}) {
      const query = String(filters.search || "").trim().toLowerCase();
      return state.employees
        .filter((employee) => !filters.tenantId || employee.tenantId === filters.tenantId)
        .filter((employee) => !filters.companyId || employee.companyId === filters.companyId)
        .filter((employee) => !filters.statusCode || employee.statusCode === filters.statusCode)
        .filter((employee) => {
          if (!query) return true;
          return `${employee.employeeNumber} ${employee.displayName} ${employee.department || ""} ${employee.jobTitle || ""}`.toLowerCase().includes(query);
        })
        .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
    },
    createEmployee(input) {
      const employee = createEmployeeRecord(state, input);
      persist(dataFile, state);
      return employee;
    },
    getEmployee(employeeId) {
      return state.employees.find((employee) => employee.employeeId === employeeId) || null;
    },
    listPolicies(filters = {}) {
      return state.policies.filter((policy) => scopeMatch(policy, filters));
    },
    listOpeningSeeds(filters = {}) {
      return state.openingSeeds.filter((seed) => scopeMatch(seed, filters));
    },
    createOpeningSeed(input) {
      const seedRecord = createSeedRecord(state, input);
      state.openingSeeds.push(seedRecord);
      state.entitlementEvents.push({
        eventId: randomUUID(),
        tenantId: seedRecord.tenantId,
        companyId: seedRecord.companyId,
        employeeId: seedRecord.employeeId,
        eventDate: seedRecord.seedDate,
        eventType: "seed",
        amount: seedRecord.amount,
        currencyCode: "BHD",
        sourceReference: seedRecord.sourceReference || "opening-seed"
      });
      persist(dataFile, state);
      return seedRecord;
    },
    listAllocations(filters = {}) {
      return state.allocations.filter((allocation) => scopeMatch(allocation, filters));
    },
    createAllocation(input) {
      const allocation = createAllocationRecord(state, input);
      state.allocations.push(allocation);
      state.entitlementEvents.push({
        eventId: randomUUID(),
        tenantId: allocation.tenantId,
        companyId: allocation.companyId,
        employeeId: allocation.employeeId,
        eventDate: allocation.allocationDate,
        eventType: "usage",
        amount: allocation.entitlementApplied,
        currencyCode: "BHD",
        sourceReference: allocation.allocationId
      });
      persist(dataFile, state);
      return allocation;
    },
    listLoans(filters = {}) {
      return state.loans.filter((loan) => scopeMatch(loan, filters));
    },
    createLoan(input) {
      const loan = createLoanRecord(state, input);
      state.loans.push(loan);
      persist(dataFile, state);
      return loan;
    },
    loanSummary(filters = {}) {
      const loans = this.listLoans(filters);
      return {
        totalLoans: loans.length,
        activeLoans: loans.filter((loan) => loan.statusCode === "active").length,
        settledLoans: loans.filter((loan) => loan.statusCode === "settled").length,
        principalAmount: roundMoney(loans.reduce((sum, loan) => sum + loan.principalAmount, 0)),
        monthlyEmi: roundMoney(loans.filter((loan) => loan.statusCode === "active").reduce((sum, loan) => sum + loan.emiAmount, 0))
      };
    },
    entitlementBalance({ tenantId, companyId, employeeId, asOfDate }) {
      requireIsoDate(asOfDate, "asOfDate");
      const rows = state.employees
        .filter((employee) => !tenantId || employee.tenantId === tenantId)
        .filter((employee) => !companyId || employee.companyId === companyId)
        .filter((employee) => !employeeId || employee.employeeId === employeeId)
        .map((employee) => {
          const events = state.entitlementEvents.filter((event) =>
            event.employeeId === employee.employeeId &&
            event.eventDate <= asOfDate
          );
          const earned = events
            .filter((event) => ["seed", "accrual", "adjustment", "reversal"].includes(event.eventType))
            .reduce((sum, event) => sum + event.amount, 0);
          const used = events
            .filter((event) => event.eventType === "usage")
            .reduce((sum, event) => sum + event.amount, 0);
          const balance = roundMoney(Math.max(0, earned - used));
          return {
            employeeId: employee.employeeId,
            employeeNumber: employee.employeeNumber,
            displayName: employee.displayName,
            asOfDate,
            earnedAmount: roundMoney(earned),
            usedAmount: roundMoney(used),
            balanceAmount: balance,
            currencyCode: "BHD"
          };
        });
      return rows;
    },
    moduleSummary({ tenantId, companyId, asOfDate }) {
      const employees = this.listEmployees({ tenantId, companyId });
      const balances = this.entitlementBalance({ tenantId, companyId, asOfDate });
      const loanSummary = this.loanSummary({ tenantId, companyId });
      return {
        asOfDate,
        employees: { total: employees.length, active: employees.filter((employee) => employee.statusCode === "active").length },
        entitlement: {
          totalBalance: roundMoney(balances.reduce((sum, row) => sum + row.balanceAmount, 0)),
          totalUsed: roundMoney(balances.reduce((sum, row) => sum + row.usedAmount, 0))
        },
        allocations: { total: this.listAllocations({ tenantId, companyId }).length },
        openingSeeds: { total: this.listOpeningSeeds({ tenantId, companyId }).length },
        loans: loanSummary
      };
    }
  };
}

function createEmployeeRecord(state, input) {
  const normalized = normalizeEmployee(input);
  assertKnownTenantCompany(state, normalized.tenantId, normalized.companyId);
  const key = employeeBusinessKey(normalized);
  if (state.employees.some((employee) => employeeBusinessKey(employee) === key)) {
    throwProblem("EMPLOYEE_DUPLICATE", 409, "Employee number already exists for this tenant and company.");
  }
  const timestamp = new Date().toISOString();
  const employee = { employeeId: randomUUID(), createdAtUtc: timestamp, ...normalized };
  state.employees.push(employee);
  return employee;
}

function createSeedRecord(state, input) {
  const base = scopedInput(state, input);
  requireIsoDate(base.seedDate, "seedDate");
  const amount = requireNonNegativeMoney(base.amount, "amount");
  const days = Number(base.days || 0);
  if (!Number.isFinite(days) || days < 0) throwProblem("INVALID_DAYS", 422, "days must be a non-negative number.");
  return {
    seedId: randomUUID(),
    tenantId: base.tenantId,
    companyId: base.companyId,
    employeeId: base.employeeId,
    seedDate: base.seedDate,
    amount,
    days,
    sourceReference: String(base.sourceReference || "manual").trim()
  };
}

function createAllocationRecord(state, input) {
  const base = scopedInput(state, input);
  requireIsoDate(base.allocationDate, "allocationDate");
  const ticketCost = requireNonNegativeMoney(base.ticketCost, "ticketCost");
  const available = stateApi(state).entitlementBalance({
    tenantId: base.tenantId,
    companyId: base.companyId,
    employeeId: base.employeeId,
    asOfDate: base.allocationDate
  })[0]?.balanceAmount || 0;
  const entitlementApplied = roundMoney(Math.min(ticketCost, available));
  const companyPaid = roundMoney(Math.max(0, ticketCost - entitlementApplied));
  return {
    allocationId: randomUUID(),
    tenantId: base.tenantId,
    companyId: base.companyId,
    employeeId: base.employeeId,
    allocationDate: base.allocationDate,
    ticketCost,
    entitlementApplied,
    companyPaid,
    statusCode: "posted"
  };
}

function createLoanRecord(state, input) {
  const base = scopedInput(state, input);
  requireIsoDate(base.startDate, "startDate");
  const principalAmount = requireNonNegativeMoney(base.principalAmount, "principalAmount");
  const emiAmount = requireNonNegativeMoney(base.emiAmount, "emiAmount");
  return {
    loanId: randomUUID(),
    tenantId: base.tenantId,
    companyId: base.companyId,
    employeeId: base.employeeId,
    principalAmount,
    emiAmount,
    startDate: base.startDate,
    statusCode: "active"
  };
}

function scopedInput(state, input) {
  const tenantId = String(input?.tenantId || "").trim();
  const companyId = String(input?.companyId || "").trim();
  const employeeId = String(input?.employeeId || "").trim();
  assertKnownTenantCompany(state, tenantId, companyId);
  const employee = state.employees.find((row) => row.employeeId === employeeId && row.tenantId === tenantId && row.companyId === companyId);
  if (!employee) throwProblem("EMPLOYEE_NOT_FOUND", 422, "employeeId does not exist for tenantId/companyId.");
  return { ...input, tenantId, companyId, employeeId };
}

function assertKnownTenantCompany(state, tenantId, companyId) {
  if (!state.tenants.some((tenant) => tenant.tenantId === tenantId)) throwProblem("TENANT_NOT_FOUND", 422, "tenantId does not exist.");
  if (!state.companies.some((company) => company.companyId === companyId && company.tenantId === tenantId)) {
    throwProblem("COMPANY_NOT_FOUND", 422, "companyId does not exist for tenantId.");
  }
}

function scopeMatch(row, filters) {
  return (!filters.tenantId || row.tenantId === filters.tenantId) &&
    (!filters.companyId || row.companyId === filters.companyId) &&
    (!filters.employeeId || row.employeeId === filters.employeeId);
}

function requireIsoDate(value, fieldName) {
  if (!isIsoDate(String(value || ""))) throwProblem("INVALID_DATE", 422, `${fieldName} must be YYYY-MM-DD.`);
}

function requireNonNegativeMoney(value, fieldName) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throwProblem("INVALID_AMOUNT", 422, `${fieldName} must be a non-negative number.`);
  return roundMoney(amount);
}

function throwProblem(code, statusCode, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function loadState(dataFile, seed) {
  if (dataFile && existsSync(dataFile)) return JSON.parse(readFileSync(dataFile, "utf8"));
  const initial = structuredCloneSafe(seed);
  persist(dataFile, initial);
  return initial;
}

function persist(dataFile, state) {
  if (!dataFile) return;
  mkdirSync(dirname(dataFile), { recursive: true });
  writeFileSync(dataFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function ensureIndexes(state) {
  for (const key of ["tenants", "companies", "employees", "policies", "entitlementEvents", "allocations", "loans", "openingSeeds"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function stateApi(state) {
  return createGreenfieldStore({ seed: state });
}
