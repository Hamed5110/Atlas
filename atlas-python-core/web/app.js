"use strict";

const $ = (id) => document.getElementById(id);

const state = {
  screen: "employees",
  page: 1,
  pageSize: 25,
  search: "",
  status: "",
  employees: [],
  total: 0,
  editingId: null,
  editingRowVersion: null,
  importPreviewToken: null,
  importHasErrors: false,
  lastEntitlement: null
};

const navItems = [
  ["employees", "Employee Master", "1"],
  ["import", "Master Import", "2"],
  ["entitlement", "Entitlement + Claims", "3"],
  ["reconciliation", "Field Matrix", "4"]
];

const employeeSections = [
  {
    id: "personal",
    label: "Personal",
    fields: [
      field("employee_code", "Employee Code / ID", "text", { required: true, maxLength: 50, legacy: "EMP_NO", note: "Required, trim whitespace, auto-uppercase" }),
      field("punch_machine_id", "Punch Machine ID", "text", { maxLength: 50, legacy: "PUNCH_ID", note: "Optional biometric/time machine reference" }),
      field("full_name", "Full Name", "text", { required: true, maxLength: 200, span: 2, legacy: "EMP_NAME", note: "Required, min 3 characters" }),
      field("first_name", "First Name", "text", { required: true, maxLength: 80, legacy: "FIRST_NAME", note: "Required" }),
      field("middle_name", "Middle Name", "text", { maxLength: 80, legacy: "MIDDLE_NAME", note: "Optional" }),
      field("last_name", "Last Name", "text", { required: true, maxLength: 80, legacy: "LAST_NAME", note: "Required" }),
      field("passport_name", "Passport Name", "text", { maxLength: 200, legacy: "PASSPORT_NAME", note: "Legal travel name" }),
      field("gender", "Gender", "select", { required: true, options: ["Male", "Female", "Other", "Undisclosed"], legacy: "GENDER", note: "Controlled value" }),
      field("date_of_birth", "Date of Birth", "date", { required: true, legacy: "DOB", note: "Must be before joining date" }),
      field("nationality", "Nationality", "text", { required: true, maxLength: 80, legacy: "NATIONALITY", note: "Required" }),
      field("religion", "Religion", "text", { maxLength: 80, legacy: "RELIGION", note: "Optional" }),
      field("marital_status", "Marital Status", "select", { options: ["", "Single", "Married", "Divorced", "Widowed", "Other"], legacy: "MARITAL_STATUS", note: "Controlled optional value" })
    ]
  },
  {
    id: "job",
    label: "Job Details",
    fields: [
      field("joining_date", "Joining Date", "date", { required: true, legacy: "JOINING_DATE", note: "ISO date required" }),
      field("probation_end_date", "Probation End Date", "date", { legacy: "PROBATION_END_DATE", note: "Cannot be before joining date" }),
      field("confirmation_date", "Confirmation Date", "date", { legacy: "CONFIRMATION_DATE", note: "Cannot be before joining date" }),
      field("department_id", "Department ID", "number", { min: 1, legacy: "DEPT_ID", note: "FK placeholder to core.Departments" }),
      field("designation", "Designation / Role", "text", { required: true, maxLength: 120, legacy: "DESIGNATION", note: "Required job title" }),
      field("grade_level", "Grade / Level", "text", { maxLength: 60, legacy: "GRADE", note: "Optional grade band" }),
      field("branch_id", "Branch / Location ID", "number", { min: 1, legacy: "BRANCH_ID", note: "FK placeholder to core.Branches" }),
      field("employment_type", "Employment Type", "select", { required: true, options: ["Permanent", "Contract", "Probation", "Temporary", "Intern"], legacy: "EMP_TYPE", note: "Controlled value" }),
      field("status", "Status", "select", { required: true, options: ["Active", "Inactive", "Resigned", "Terminated", "OnLeave"], legacy: "STATUS", note: "Soft-delete sets inactive" }),
      field("direct_manager_id", "Direct Manager ID", "number", { min: 1, legacy: "SUPERVISOR_ID", note: "Self-FK placeholder" })
    ]
  },
  {
    id: "contact",
    label: "Contact",
    fields: [
      field("personal_email", "Personal Email", "email", { legacy: "PERSONAL_EMAIL", note: "Validated email format" }),
      field("work_email", "Work Email", "email", { legacy: "WORK_EMAIL", note: "Validated email format" }),
      field("mobile_number", "Mobile Number", "text", { maxLength: 40, legacy: "MOBILE_NO", note: "Optional" }),
      field("emergency_contact_name", "Emergency Contact Name", "text", { maxLength: 160, legacy: "EMERGENCY_NAME", note: "Optional" }),
      field("emergency_contact_phone", "Emergency Contact Phone", "text", { maxLength: 40, legacy: "EMERGENCY_PHONE", note: "Optional" }),
      field("emergency_contact_relationship", "Emergency Relationship", "text", { maxLength: 80, legacy: "EMERGENCY_RELATION", note: "Optional" }),
      field("local_address", "Local Address", "textarea", { span: 2, legacy: "LOCAL_ADDRESS", note: "Optional" }),
      field("home_country_address", "Home Country Address", "textarea", { span: 2, legacy: "PERMANENT_ADDRESS", note: "Optional" })
    ]
  },
  {
    id: "identity",
    label: "Identity Docs",
    fields: [
      field("passport_number", "Passport Number", "text", { maxLength: 80, legacy: "PASSPORT_NO", note: "Unique when supplied; required for expatriates by policy" }),
      field("passport_expiry", "Passport Expiry", "date", { legacy: "PASSPORT_EXPIRY", note: "Tracked for expiry report" }),
      field("civil_id", "Civil / Resident ID", "text", { maxLength: 80, legacy: "CIVIL_ID", note: "Unique when supplied" }),
      field("civil_id_expiry", "Civil ID Expiry", "date", { legacy: "CIVIL_ID_EXPIRY", note: "Tracked for expiry report" }),
      field("visa_number", "Visa Number", "text", { maxLength: 80, legacy: "VISA_NO", note: "Optional" }),
      field("visa_type", "Visa Type", "text", { maxLength: 80, legacy: "VISA_TYPE", note: "Optional" }),
      field("visa_expiry", "Visa Expiry", "date", { legacy: "VISA_EXPIRY", note: "Tracked for expiry report" }),
      field("labour_card_number", "Labour Card Number", "text", { maxLength: 80, legacy: "LABOUR_CARD_NO", note: "Optional" }),
      field("labour_card_expiry", "Labour Card Expiry", "date", { legacy: "LABOUR_CARD_EXPIRY", note: "Tracked for expiry report" })
    ]
  },
  {
    id: "salary",
    label: "Salary + Bank",
    fields: [
      field("basic_salary", "Basic Salary", "number", { required: true, min: 0, step: "0.001", legacy: "BASIC_SAL", note: "DECIMAL(18,3), non-negative" }),
      field("housing_allowance", "Housing Allowance", "number", { min: 0, step: "0.001", legacy: "HOUSE_ALLOW", note: "DECIMAL(18,3), non-negative" }),
      field("transport_allowance", "Transport Allowance", "number", { min: 0, step: "0.001", legacy: "TRANSPORT_ALLOW", note: "DECIMAL(18,3), non-negative" }),
      field("other_fixed_allowances", "Other Fixed Allowances", "number", { min: 0, step: "0.001", legacy: "OTHER_ALLOW", note: "DECIMAL(18,3), non-negative" }),
      field("payment_mode", "Payment Mode", "select", { required: true, options: ["Bank", "Cash", "WPS"], legacy: "PAY_MODE", note: "IBAN required for Bank/WPS" }),
      field("bank_name", "Bank Name", "text", { maxLength: 160, legacy: "BANK_NAME", note: "Optional for cash" }),
      field("iban_account_number", "IBAN / Account Number", "text", { maxLength: 80, legacy: "IBAN", note: "Required for Bank/WPS" }),
      field("swift_code", "Swift Code", "text", { maxLength: 40, legacy: "SWIFT_CODE", note: "Optional" })
    ]
  },
  {
    id: "exit",
    label: "Exit Tracking",
    fields: [
      field("resignation_date", "Resignation Date", "date", { legacy: "RESIGN_DATE", note: "Optional" }),
      field("last_working_day", "Last Working Day", "date", { legacy: "LAST_WORKING_DAY", note: "Required for resigned/terminated status" }),
      field("reason_for_leaving", "Reason for Leaving", "textarea", { span: 2, maxLength: 400, legacy: "LEAVING_REASON", note: "Optional exit note" }),
      field("rehire_eligible", "Rehire Eligible", "select", { options: ["true", "false"], legacy: "REHIRE_ELIGIBLE", note: "Boolean" })
    ]
  }
];

const allEmployeeFields = employeeSections.flatMap((section) => section.fields);
const tableColumns = [
  "employee_code", "full_name", "gender", "date_of_birth", "nationality", "joining_date", "designation", "employment_type", "status",
  "work_email", "mobile_number", "passport_number", "passport_expiry", "civil_id", "civil_id_expiry", "basic_salary", "housing_allowance",
  "transport_allowance", "other_fixed_allowances", "payment_mode", "bank_name", "iban_account_number"
];

function field(name, label, type, config = {}) {
  return { name, label, type, required: false, span: 1, ...config };
}

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: isForm ? { ...(options.headers || {}) } : { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const text = await response.text();
  const data = text ? safeJson(text) : {};
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${typeof data.detail === "string" ? data.detail : text}`);
  }
  return data;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function money(value) {
  return `BHD ${Number(value || 0).toFixed(3)}`;
}

function metric(label, value, note = "", tone = "") {
  return `<article class="metric ${tone}"><span>${html(label)}</span><strong>${html(value)}</strong><small>${html(note)}</small></article>`;
}

function toast(message, bad = false) {
  const node = $("toast");
  node.textContent = message;
  node.className = `show ${bad ? "bad" : "ok"}`;
  setTimeout(() => { node.className = ""; }, 4500);
}

function renderNav() {
  $("moduleNav").innerHTML = navItems.map(([id, label, key]) => `
    <button type="button" data-screen="${id}" class="${state.screen === id ? "active" : ""}">
      <b>${key}</b><span>${html(label)}</span><kbd class="kbd">Ctrl ${key}</kbd>
    </button>
  `).join("");
}

function renderEmployeeForm() {
  $("employeeTabs").innerHTML = employeeSections.map((section, index) =>
    `<button type="button" data-tab="${section.id}" class="tab ${index === 0 ? "active" : ""}">${html(section.label)}</button>`
  ).join("");
  $("employeeForm").innerHTML = employeeSections.map((section, index) => `
    <div class="tab-panel span-4 ${index === 0 ? "active" : ""}" data-panel="${section.id}">
      <div class="grid-form">
        ${section.fields.map(renderField).join("")}
      </div>
    </div>
  `).join("");
  setDefaultEmployeeValues();
}

function renderField(f) {
  const cls = f.span === 2 ? "span-2" : f.span === 4 ? "span-4" : "";
  const required = f.required ? "required" : "";
  const common = `name="${f.name}" id="emp_${f.name}" ${required} ${f.maxLength ? `maxlength="${f.maxLength}"` : ""}`;
  let control;
  if (f.type === "select") {
    control = `<select ${common}>${(f.options || []).map((option) => `<option value="${html(option)}">${html(option || "—")}</option>`).join("")}</select>`;
  } else if (f.type === "textarea") {
    control = `<textarea ${common}></textarea>`;
  } else {
    control = `<input ${common} type="${f.type}" ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.step ? `step="${f.step}"` : ""}>`;
  }
  return `<label class="${cls}"><span>${html(f.label)}${f.required ? " *" : ""}</span>${control}</label>`;
}

function setDefaultEmployeeValues() {
  const defaults = {
    gender: "Male",
    marital_status: "Single",
    employment_type: "Permanent",
    status: "Active",
    payment_mode: "Bank",
    basic_salary: "0.000",
    housing_allowance: "0.000",
    transport_allowance: "0.000",
    other_fixed_allowances: "0.000",
    rehire_eligible: "true"
  };
  Object.entries(defaults).forEach(([key, value]) => {
    const input = $(`emp_${key}`);
    if (input) input.value = value;
  });
}

function clearEmployeeForm() {
  state.editingId = null;
  state.editingRowVersion = null;
  $("employeeForm").reset();
  setDefaultEmployeeValues();
  toast("Ready for new employee.");
}

function formPayload() {
  const form = new FormData($("employeeForm"));
  const payload = {};
  for (const f of allEmployeeFields) {
    const raw = form.get(f.name);
    const value = raw === null ? "" : String(raw).trim();
    if (value === "") {
      payload[f.name] = null;
    } else if (["department_id", "branch_id", "direct_manager_id"].includes(f.name)) {
      payload[f.name] = Number(value);
    } else if (f.name === "rehire_eligible") {
      payload[f.name] = value === "true";
    } else {
      payload[f.name] = value;
    }
  }
  payload.employee_code = String(payload.employee_code || "").trim().toUpperCase();
  payload.basic_salary = payload.basic_salary || "0.000";
  payload.housing_allowance = payload.housing_allowance || "0.000";
  payload.transport_allowance = payload.transport_allowance || "0.000";
  payload.other_fixed_allowances = payload.other_fixed_allowances || "0.000";
  if (state.editingRowVersion) payload.row_version = state.editingRowVersion;
  return payload;
}

async function saveEmployee(event) {
  event.preventDefault();
  const payload = formPayload();
  if (!payload.employee_code || !payload.full_name || payload.full_name.length < 3) {
    toast("Employee Code and Full Name with at least 3 characters are required.", true);
    return;
  }
  const method = state.editingId ? "PUT" : "POST";
  const url = state.editingId ? `/api/v1/employees/${state.editingId}` : "/api/v1/employees";
  const saved = await api(url, { method, body: JSON.stringify(payload) });
  state.editingId = saved.employee_id;
  state.editingRowVersion = saved.row_version;
  toast(`Employee ${saved.employee_code} saved.`);
  await loadEmployees();
}

async function loadEmployees() {
  const params = new URLSearchParams({ page: String(state.page), limit: String(state.pageSize) });
  if (state.search) params.set("search", state.search);
  if (state.status) params.set("status", state.status);
  const result = await api(`/api/v1/employees?${params}`);
  state.employees = result.items || [];
  state.total = result.total || 0;
  renderEmployeeGrid();
  renderEmployeeSelectors();
  renderMetrics();
}

function renderEmployeeGrid() {
  $("employeeTableHead").innerHTML = `<tr>${tableColumns.map((col) => `<th>${html(labelFor(col))}</th>`).join("")}<th>Actions</th></tr>`;
  $("employeeTableBody").innerHTML = state.employees.length ? state.employees.map((employee) => `
    <tr>
      ${tableColumns.map((col) => `<td>${formatCell(employee, col)}</td>`).join("")}
      <td><div class="row-actions">
        <button class="btn" data-edit="${employee.employee_id}">Edit</button>
        <button class="btn" data-view="${employee.employee_id}">View</button>
        <button class="btn danger" data-delete="${employee.employee_id}">Delete</button>
      </div></td>
    </tr>
  `).join("") : `<tr><td colspan="${tableColumns.length + 1}">No employees found. Use the form or import verification workflow.</td></tr>`;
  const maxPage = Math.max(1, Math.ceil(state.total / state.pageSize));
  $("employeePageInfo").textContent = `Page ${state.page} of ${maxPage} · ${state.total} record(s)`;
}

function labelFor(name) {
  return allEmployeeFields.find((f) => f.name === name)?.label || name.replaceAll("_", " ");
}

function formatCell(employee, col) {
  const value = employee[col];
  if (col.includes("salary") || col.includes("allowance")) return `<strong>${money(value)}</strong>`;
  if (col === "status") return `<span class="badge ${value === "Active" ? "ok" : "warn"}">${html(value)}</span>`;
  return `<span>${html(value ?? "—")}</span>`;
}

function renderMetrics() {
  const active = state.employees.filter((employee) => employee.status === "Active").length;
  const probation = state.employees.filter((employee) => employee.employment_type === "Probation").length;
  const payroll = state.employees.reduce((sum, employee) => sum + Number(employee.basic_salary || 0) + Number(employee.housing_allowance || 0) + Number(employee.transport_allowance || 0) + Number(employee.other_fixed_allowances || 0), 0);
  $("employeeMetrics").innerHTML = [
    metric("Total Records", state.total, "server-side count"),
    metric("Active", active, "visible page active"),
    metric("Probation", probation, "visible page probation"),
    metric("Page Payroll", money(payroll), "basic + fixed allowances")
  ].join("");
}

function populateEmployeeForm(employee) {
  state.editingId = employee.employee_id;
  state.editingRowVersion = employee.row_version;
  for (const f of allEmployeeFields) {
    const input = $(`emp_${f.name}`);
    if (!input) continue;
    const value = employee[f.name];
    input.value = value === null || value === undefined ? "" : String(value).slice(0, f.type === "date" ? 10 : 999);
  }
  showScreen("employees");
  toast(`Editing ${employee.employee_code}.`);
}

async function editEmployee(id) {
  const employee = await api(`/api/v1/employees/${id}`);
  populateEmployeeForm(employee);
}

async function deleteEmployee(id) {
  if (!confirm("Soft-delete this employee?")) return;
  await api(`/api/v1/employees/${id}`, { method: "DELETE" });
  toast("Employee soft-deleted.");
  await loadEmployees();
}

function renderEmployeeSelectors() {
  const options = state.employees.map((employee) => `<option value="${employee.employee_id}">${html(employee.employee_code)} — ${html(employee.full_name)}</option>`).join("");
  if ($("claimEmployee")) $("claimEmployee").innerHTML = options;
}

async function loadHealth() {
  const health = await api("/api/v1/health");
  const ok = health.status === "ok" && health.port === 3356 && health.oldRuntimeLinked === false && health.legacyBatchCloseLinked === false;
  $("apiBadge").textContent = ok ? "API Online - Port 3356" : "API review";
  $("apiBadge").className = `badge ${ok ? "ok" : "bad"}`;
  $("dbBadge").textContent = `${health.database.serverName} / ${health.database.databaseName}`;
  $("dbBadge").className = "badge ok";
  $("sidebarStatus").textContent = ok ? "API Online" : "API Error";
  $("sidebarDb").textContent = `${health.database.serverName} · ${health.database.databaseName}`;
}

function renderFieldMatrix() {
  const rows = [
    ...allEmployeeFields.map((f) => [f.legacy, legacyType(f), f.name, mssqlColumn(f.name), f.note]),
    ["AIRFARE_RATE", "NUMERIC(18,2), global/company policy", "monthly_rate", "core.SystemSettings[airfare.monthly_rate_bhd]", "Continuous monthly rate used for elapsed-service accrual"],
    ["AIRFARE_CLAIM_AMOUNT", "NUMERIC(18,2), cannot exceed balance", "claim_amount", "core.AirfareClaims.ClaimAmount DECIMAL(18,3)", "Validated by Pydantic and submitted as claim transaction"],
    ["AIRFARE_SECTOR", "VARCHAR(20)", "sector_code", "core.AirfareClaims.SectorCode NVARCHAR(40)", "Required route/sector code"],
    ["OPENING_BALANCE", "NUMERIC(18,2), legacy seed", "seed_evidence.amount", "core.SeedEvidence.Amount DECIMAL(18,3)", "Seed evidence only; continuous balance computes from rules + claims + seeds"]
  ];
  $("fieldMatrixBody").innerHTML = rows.map((r) => `<tr>${r.map((cell) => `<td>${html(cell || "—")}</td>`).join("")}</tr>`).join("");
}

function legacyType(f) {
  if (f.type === "date") return "DATETIME/DATE";
  if (f.type === "number") return f.step ? "NUMERIC(18,2)" : "INT";
  if (f.type === "select") return "VARCHAR controlled list";
  if (f.type === "textarea") return "NVARCHAR(MAX)";
  if (f.type === "email") return "VARCHAR email";
  return "VARCHAR";
}

function mssqlColumn(name) {
  const map = {
    employee_code: "core.Employees.EmployeeCode NVARCHAR(50) UNIQUE",
    punch_machine_id: "core.Employees.PunchMachineID NVARCHAR(50)",
    full_name: "core.Employees.FullName NVARCHAR(200) NOT NULL",
    first_name: "core.Employees.FirstName NVARCHAR(80) NOT NULL",
    middle_name: "core.Employees.MiddleName NVARCHAR(80)",
    last_name: "core.Employees.LastName NVARCHAR(80) NOT NULL",
    passport_name: "core.Employees.PassportName NVARCHAR(200)",
    gender: "core.Employees.Gender NVARCHAR(20) CHECK",
    date_of_birth: "core.Employees.DateOfBirth DATE NOT NULL",
    nationality: "core.Employees.Nationality NVARCHAR(80) NOT NULL",
    religion: "core.Employees.Religion NVARCHAR(80)",
    marital_status: "core.Employees.MaritalStatus NVARCHAR(30)",
    joining_date: "core.Employees.JoiningDate DATE NOT NULL",
    probation_end_date: "core.Employees.ProbationEndDate DATE",
    confirmation_date: "core.Employees.ConfirmationDate DATE",
    department_id: "core.Employees.DepartmentID INT FK",
    designation: "core.Employees.Designation NVARCHAR(120) NOT NULL",
    grade_level: "core.Employees.GradeLevel NVARCHAR(60)",
    branch_id: "core.Employees.BranchID INT FK",
    employment_type: "core.Employees.EmploymentType NVARCHAR(30) CHECK",
    status: "core.Employees.Status NVARCHAR(30) CHECK",
    direct_manager_id: "core.Employees.DirectManagerID INT FK",
    personal_email: "core.Employees.PersonalEmail VARCHAR(254)",
    work_email: "core.Employees.WorkEmail VARCHAR(254)",
    mobile_number: "core.Employees.MobileNumber NVARCHAR(40)",
    emergency_contact_name: "core.Employees.EmergencyContactName NVARCHAR(160)",
    emergency_contact_phone: "core.Employees.EmergencyContactPhone NVARCHAR(40)",
    emergency_contact_relationship: "core.Employees.EmergencyContactRelationship NVARCHAR(80)",
    local_address: "core.Employees.LocalAddress NVARCHAR(MAX)",
    home_country_address: "core.Employees.HomeCountryAddress NVARCHAR(MAX)",
    passport_number: "core.Employees.PassportNumber NVARCHAR(80) UNIQUE",
    passport_expiry: "core.Employees.PassportExpiry DATE",
    civil_id: "core.Employees.CivilID NVARCHAR(80) UNIQUE",
    civil_id_expiry: "core.Employees.CivilIDExpiry DATE",
    visa_number: "core.Employees.VisaNumber NVARCHAR(80)",
    visa_type: "core.Employees.VisaType NVARCHAR(80)",
    visa_expiry: "core.Employees.VisaExpiry DATE",
    labour_card_number: "core.Employees.LabourCardNumber NVARCHAR(80)",
    labour_card_expiry: "core.Employees.LabourCardExpiry DATE",
    basic_salary: "core.Employees.BasicSalary DECIMAL(18,3)",
    housing_allowance: "core.Employees.HousingAllowance DECIMAL(18,3)",
    transport_allowance: "core.Employees.TransportAllowance DECIMAL(18,3)",
    other_fixed_allowances: "core.Employees.OtherFixedAllowances DECIMAL(18,3)",
    payment_mode: "core.Employees.PaymentMode NVARCHAR(20) CHECK",
    bank_name: "core.Employees.BankName NVARCHAR(160)",
    iban_account_number: "core.Employees.IBANAccountNumber NVARCHAR(80)",
    swift_code: "core.Employees.SwiftCode NVARCHAR(40)",
    resignation_date: "core.Employees.ResignationDate DATE",
    last_working_day: "core.Employees.LastWorkingDay DATE",
    reason_for_leaving: "core.Employees.ReasonForLeaving NVARCHAR(400)",
    rehire_eligible: "core.Employees.RehireEligible BIT"
  };
  return map[name] || name;
}

async function verifyImportFile() {
  const file = $("importFile").files[0];
  if (!file) {
    toast("Select a CSV or XLSX file first.", true);
    return;
  }
  const form = new FormData();
  form.append("file", file);
  setProgress(30);
  const result = await api("/api/v1/import/verify-preview", { method: "POST", body: form });
  state.importPreviewToken = result.previewToken;
  state.importHasErrors = Number(result.errorRowsCount) > 0;
  renderImportPreview(result);
  setProgress(100);
  updateCommitState();
  toast("Import preview verified. Database unchanged.");
}

function renderImportPreview(result) {
  const metrics = [
    metric("Total Rows", result.totalRows, "parsed"),
    metric("Valid Rows", result.validRowsCount, "commit eligible"),
    metric("Error Rows", result.errorRowsCount, "review required"),
    metric("Duplicates", result.duplicateRowsCount, "blocked")
  ].join("");
  $("importMetrics").innerHTML = metrics;
  $("modalImportMetrics").innerHTML = metrics;
  const rows = (result.previewData || []).map((record) => {
    const errors = record.fields.filter((f) => f.status !== "VALID").map((f) => `${f.column}: ${f.reason}`).join("; ");
    return `<tr>
      <td>${record.row}</td>
      <td><span class="badge ${record.status === "VALID" ? "ok" : "bad"}">${html(record.status)}</span></td>
      <td>${record.fields.slice(0, 10).map((f) => `<span class="badge ${f.status === "VALID" ? "ok" : f.status === "WARNING" ? "warn" : "bad"}" title="${html(f.reason || "valid")}">${html(f.column)}</span>`).join(" ")}</td>
      <td>${html(errors || "—")}</td>
    </tr>`;
  }).join("");
  $("modalImportRows").innerHTML = rows;
  $("inlineImportRows").innerHTML = rows;
}

function updateCommitState() {
  $("commitImport").disabled = !state.importPreviewToken || ($("ackImportErrors").value !== "yes" && state.importHasErrors);
}

async function commitImport() {
  if (!state.importPreviewToken) {
    toast("Verify import first.", true);
    return;
  }
  setProgress(45);
  const result = await api("/api/v1/import/commit", { method: "POST", body: JSON.stringify({ previewToken: state.importPreviewToken }) });
  setProgress(100);
  toast(`Import committed: ${result.insertedRows} inserted, ${result.skippedRows} skipped.`);
  state.importPreviewToken = null;
  await loadEmployees();
}

function setProgress(value) {
  $("importProgress").style.width = `${value}%`;
}

async function computeEntitlement() {
  const employeeId = $("claimEmployee").value;
  const target = $("claimTargetDate").value;
  if (!employeeId || !target) {
    toast("Employee and target date are required.", true);
    return;
  }
  const result = await api(`/api/v1/airfare/entitlement/${employeeId}?target_date=${encodeURIComponent(target)}`);
  state.lastEntitlement = result;
  $("claimAccruedBalance").value = Number(result.accruedBalance || 0).toFixed(3);
  $("entitlementMetrics").innerHTML = [
    metric("Accrued Entitlement", money(result.accruedBalance), `${result.elapsedServiceDays} service days`),
    metric("Claimed To Date", money(result.claimedBalance), "approved claims"),
    metric("Seed Evidence", money(result.seedBalance), "opening evidence"),
    metric("Remaining Balance", money(result.availableBalance), result.model)
  ].join("");
}

async function submitClaim(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData($("claimForm")).entries());
  payload.employee_id = Number(payload.employee_id);
  payload.claim_amount = String(payload.claim_amount || "0.000");
  payload.accrued_balance = String(payload.accrued_balance || "0.000");
  const result = await api("/api/v1/airfare/claims", { method: "POST", body: JSON.stringify(payload) });
  $("claimResult").innerHTML = `<span class="badge ok">Claim ${result.claimId} ${result.status}</span>`;
  toast(`Claim ${result.claimId} submitted.`);
}

function showScreen(id) {
  state.screen = id;
  document.querySelectorAll(".screen").forEach((node) => node.classList.toggle("active", node.id === `screen-${id}`));
  document.querySelectorAll("[data-screen]").forEach((node) => node.classList.toggle("active", node.dataset.screen === id));
  $("screenTitle").textContent = navItems.find((item) => item[0] === id)?.[1] || "ATLAS";
  if (window.innerWidth <= 1100) $("sidebar").classList.remove("open");
}

function bindEvents() {
  $("moduleNav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-screen]");
    if (button) showScreen(button.dataset.screen);
  });
  $("employeeTabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (!tab) return;
    document.querySelectorAll("[data-tab]").forEach((node) => node.classList.toggle("active", node === tab));
    document.querySelectorAll("[data-panel]").forEach((node) => node.classList.toggle("active", node.dataset.panel === tab.dataset.tab));
  });
  $("employeeForm").addEventListener("submit", (event) => saveEmployee(event).catch((error) => toast(error.message, true)));
  $("newEmployee").addEventListener("click", clearEmployeeForm);
  $("globalSearch").addEventListener("input", debounce((event) => {
    state.search = event.target.value.trim();
    state.page = 1;
    loadEmployees().catch((error) => toast(error.message, true));
  }, 300));
  $("statusFilter").addEventListener("change", (event) => {
    state.status = event.target.value;
    state.page = 1;
    loadEmployees().catch((error) => toast(error.message, true));
  });
  $("prevPage").addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    loadEmployees().catch((error) => toast(error.message, true));
  });
  $("nextPage").addEventListener("click", () => {
    if (state.page * state.pageSize < state.total) state.page += 1;
    loadEmployees().catch((error) => toast(error.message, true));
  });
  $("employeeTableBody").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit]");
    const view = event.target.closest("[data-view]");
    const del = event.target.closest("[data-delete]");
    if (edit) editEmployee(edit.dataset.edit).catch((error) => toast(error.message, true));
    if (view) editEmployee(view.dataset.view).catch((error) => toast(error.message, true));
    if (del) deleteEmployee(del.dataset.delete).catch((error) => toast(error.message, true));
  });
  $("openImportModal").addEventListener("click", () => $("importModal").classList.add("open"));
  $("closeImportModal").addEventListener("click", () => $("importModal").classList.remove("open"));
  $("verifyImport").addEventListener("click", () => verifyImportFile().catch((error) => { setProgress(0); toast(error.message, true); }));
  $("ackImportErrors").addEventListener("change", updateCommitState);
  $("commitImport").addEventListener("click", () => commitImport().catch((error) => { setProgress(0); toast(error.message, true); }));
  $("computeEntitlement").addEventListener("click", () => computeEntitlement().catch((error) => toast(error.message, true)));
  $("claimForm").addEventListener("submit", (event) => submitClaim(event).catch((error) => toast(error.message, true)));
  $("themeToggle").addEventListener("click", () => document.documentElement.classList.toggle("dark"));
  $("openSidebar").addEventListener("click", () => $("sidebar").classList.add("open"));
  document.querySelectorAll("[data-refresh]").forEach((button) => button.addEventListener("click", () => refresh().catch((error) => toast(error.message, true))));
  document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey) return;
    const item = navItems.find((nav) => nav[2] === event.key);
    if (item) {
      event.preventDefault();
      showScreen(item[0]);
    }
  });
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function setDates() {
  const today = new Date().toISOString().slice(0, 10);
  $("claimTargetDate").value = today;
  $("claimDate").value = today;
}

async function refresh() {
  await loadHealth();
  await loadEmployees();
  if (state.employees.length && !$("claimAccruedBalance").value) {
    await computeEntitlement().catch(() => undefined);
  }
}

renderNav();
renderEmployeeForm();
renderFieldMatrix();
setDates();
bindEvents();
refresh().catch((error) => toast(error.message, true));
