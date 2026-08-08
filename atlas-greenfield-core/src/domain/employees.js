const EMPLOYEE_STATUSES = new Set(["active", "inactive", "suspended", "terminated", "on_leave"]);
const EMPLOYMENT_TYPES = new Set(["full_time", "part_time", "contract", "temporary", "intern"]);

export function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeEmployee(input, now = new Date()) {
  const errors = [];
  const value = input && typeof input === "object" ? input : {};
  const tenantId = clean(value.tenantId);
  const companyId = clean(value.companyId);
  const employeeNumber = clean(value.employeeNumber);
  const displayName = clean(value.displayName);
  const legalName = clean(value.legalName);
  const workEmail = clean(value.workEmail).toLowerCase();
  const department = clean(value.department);
  const jobTitle = clean(value.jobTitle);
  const employmentType = clean(value.employmentType || "full_time");
  const statusCode = clean(value.statusCode || "active");
  const hireDate = clean(value.hireDate);
  const terminationDate = clean(value.terminationDate);

  if (!tenantId) errors.push("tenantId is required.");
  if (!companyId) errors.push("companyId is required.");
  if (!employeeNumber) errors.push("employeeNumber is required.");
  if (!displayName) errors.push("displayName is required.");
  if (!hireDate || !isIsoDate(hireDate)) errors.push("hireDate must be YYYY-MM-DD.");
  if (terminationDate && !isIsoDate(terminationDate)) errors.push("terminationDate must be YYYY-MM-DD.");
  if (terminationDate && hireDate && isIsoDate(hireDate) && terminationDate < hireDate) {
    errors.push("terminationDate cannot be before hireDate.");
  }
  if (!EMPLOYMENT_TYPES.has(employmentType)) errors.push(`employmentType must be one of ${Array.from(EMPLOYMENT_TYPES).join(", ")}.`);
  if (!EMPLOYEE_STATUSES.has(statusCode)) errors.push(`statusCode must be one of ${Array.from(EMPLOYEE_STATUSES).join(", ")}.`);
  if (workEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) errors.push("workEmail must be a valid email address.");

  if (errors.length) {
    const error = new Error(errors.join(" "));
    error.code = "EMPLOYEE_VALIDATION_FAILED";
    error.statusCode = 422;
    error.details = errors;
    throw error;
  }

  const timestamp = now.toISOString();
  return {
    tenantId,
    companyId,
    employeeNumber,
    displayName,
    legalName: legalName || null,
    workEmail: workEmail || null,
    department: department || null,
    jobTitle: jobTitle || null,
    employmentType,
    statusCode,
    hireDate,
    terminationDate: terminationDate || null,
    updatedAtUtc: timestamp
  };
}

export function employeeBusinessKey(employee) {
  return [
    employee.tenantId.toLowerCase(),
    employee.companyId.toLowerCase(),
    employee.employeeNumber.toLowerCase()
  ].join("::");
}

function clean(value) {
  return String(value ?? "").trim();
}
