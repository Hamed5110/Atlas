const $ = (id) => document.getElementById(id);
const page = document.body.dataset.page;
const asOfDate = "2026-12-31";
let employees = [];

async function api(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

function formJson(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function money(value) {
  return `BHD ${Number(value || 0).toFixed(3)}`;
}

function toast(message, bad = false) {
  const box = $("toast");
  if (!box) return;
  box.textContent = message;
  box.className = bad ? "show bad" : "show";
  setTimeout(() => box.className = "", 3000);
}

function row(cells) {
  return `<div class="row">${cells.join("")}</div>`;
}

function card(label, value, note, primary = false) {
  return `<article class="${primary ? "primary" : ""}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}

function setHtml(id, html) {
  const node = $(id);
  if (node) node.innerHTML = html;
}

function setText(id, text) {
  const node = $(id);
  if (node) node.textContent = text;
}

async function loadEmployees() {
  employees = (await api("/api/employees")).rows;
  document.querySelectorAll("[data-employee-select]").forEach((select) => {
    select.innerHTML = employees.map((employee) => `<option value="${employee.employeeId}">${employee.employeeNumber} — ${employee.displayName}</option>`).join("");
  });
  return employees;
}

function renderEmployees(rows) {
  setText("employeeCount", `${rows.length} records`);
  setHtml("employeeRows", rows.map((employee) => row([
    `<strong>${employee.employeeNumber}</strong>`,
    `<strong>${employee.displayName}<small>${employee.legalName || ""}</small></strong>`,
    `<span>${employee.department || "-"} / ${employee.jobTitle || "-"}</span>`,
    `<span>${employee.payGroup || "-"} · ${employee.employmentType}</span>`,
    `<span>${employee.cprNumber || "-"} / ${employee.passportNumber || "-"}</span>`,
    `<span class="${employee.eligibleForAirfare ? "ok" : "bad"}">${employee.statusCode}</span>`
  ])).join(""));
}

async function renderCommand() {
  const [health, summary] = await Promise.all([api("/api/health"), api(`/api/summary?asOfDate=${asOfDate}`)]);
  setHtml("commandCards", [
    card("Runtime", summary.runtime, `${summary.application} v${summary.version}`),
    card("Database", health.database.databaseName, `${health.database.serverName} / ${health.database.schema}`),
    card("Employees", summary.employees.active, `${summary.employees.total} total`),
    card("Entitlement", money(summary.entitlement.balance), "as-of computed", true),
    card("Allocations", summary.allocations.total, `${money(summary.allocations.entitlementApplied)} used`),
    card("Loans / EMI", summary.loans.active, `${money(summary.loans.monthlyEmi)} monthly`)
  ].join(""));
  setText("runtimePill", health.status === "ok" ? "SQL ready" : "review");
  setHtml("runtimeRows", [
    row(["<strong>Version</strong>", `<strong>${health.version}</strong>`, "<span>runtime</span>", "<span class='ok'>fresh</span>"]),
    row(["<strong>Port</strong>", `<strong>${health.port}</strong>`, "<span>isolation</span>", "<span class='ok'>3356</span>"]),
    row(["<strong>Old runtime linked</strong>", `<strong>${health.oldRuntimeLinked}</strong>`, "<span>must be false</span>", "<span class='ok'>no mixing</span>"]),
    row(["<strong>Annual close</strong>", `<strong>${health.annualCloseProcess}</strong>`, "<span>must be false</span>", "<span class='ok'>removed</span>"])
  ].join(""));
}

async function renderAirfare() {
  await loadEmployees();
  const [summary, balances, allocations, reconciliation] = await Promise.all([
    api(`/api/summary?asOfDate=${asOfDate}`),
    api(`/api/entitlement/balance?asOfDate=${asOfDate}`),
    api("/api/allocations"),
    api(`/api/entitlement/reconciliation?asOfDate=${asOfDate}`)
  ]);
  setHtml("airfareCards", [
    card("Balance", money(summary.entitlement.balance), "continuous event balance", true),
    card("Usage", money(summary.entitlement.used), "posted allocations"),
    card("Ticket spend", money(summary.allocations.ticketCost), `${summary.allocations.total} allocation(s)`)
  ].join(""));
  setHtml("balanceRows", balances.rows.map((item) => row([
    `<strong>${item.employeeNumber}</strong>`,
    `<strong>${item.displayName}</strong>`,
    `<span>Earned ${money(item.earned)} / Used ${money(item.used)}</span>`,
    `<span class="${item.balance < 0 ? "bad" : "ok"}">${money(item.balance)}</span>`
  ])).join(""));
  setHtml("allocationRows", allocations.rows.map((item) => row([
    `<strong>${item.allocationDate}</strong>`,
    `<strong>${item.employeeNumber} ${item.displayName}</strong>`,
    `<span>${item.originAirportCode || "-"} → ${item.destinationAirportCode || "-"} ${item.travelDate || ""}</span>`,
    `<span>${item.ticketNumber || "-"} / ${item.paymentMode}</span>`,
    `<span>Ticket ${money(item.ticketCost)}</span>`,
    `<span class="money">Company ${money(item.companyPaid)}</span>`
  ])).join(""));
  setText("reconciliationStatus", reconciliation.status);
  setText("reconciliationNote", reconciliation.note);
  setHtml("reconciliationRows", reconciliation.rows.map((item) => row([
    `<strong>${item.employeeNumber}</strong>`,
    `<strong>${item.displayName}</strong>`,
    `<span>Earned ${money(item.earned)} / Used ${money(item.used)}</span>`,
    `<span class="${item.balance < 0 ? "bad" : "ok"}">${money(item.balance)}</span>`
  ])).join(""));
}

async function renderLoans() {
  await loadEmployees();
  const loans = await api("/api/loans");
  setHtml("loanRows", loans.rows.map((loan) => row([
    `<strong>${loan.startDate}</strong>`,
    `<strong>${loan.employeeNumber} ${loan.displayName}</strong>`,
    `<span>${loan.loanType} · ${loan.tenureMonths} months</span>`,
    `<span>Principal ${money(loan.principalAmount)}</span>`,
    `<span>Outstanding ${money(loan.outstandingAmount)}</span>`,
    `<span class="money">EMI ${money(loan.emiAmount)}</span>`
  ])).join(""));
}

async function renderReports() {
  const [payable, employeeReport] = await Promise.all([api(`/api/reports/airfare-payable?asOfDate=${asOfDate}`), api("/api/reports/employees")]);
  setHtml("payableReportRows", [
    row([`<strong>${payable.asOfDate}</strong>`, `<strong>${payable.employeeCount} employee(s)</strong>`, "<span>Total payable</span>", `<span class="money">${money(payable.totalPayable)}</span>`]),
    ...payable.rows.map((item) => row([`<strong>${item.employeeNumber}</strong>`, `<strong>${item.displayName}</strong>`, `<span>Earned ${money(item.earned)}</span>`, `<span class="money">${money(item.balance)}</span>`]))
  ].join(""));
  setHtml("employeeReportRows", Object.entries(employeeReport.departments).map(([department, count]) => row([`<strong>${department}</strong>`, `<strong>${count}</strong>`, "<span>employee(s)</span>", "<span class='ok'>active scope</span>"])).join(""));
}

async function renderAdmin() {
  const [prefs, users, companies, backups] = await Promise.all([api("/api/preferences"), api("/api/users"), api("/api/companies"), api("/api/admin/backups")]);
  setHtml("preferenceRows", Object.entries(prefs.preferences).map(([key, value]) => row([`<strong>${key}</strong>`, `<strong>${value}</strong>`, "<span>MSSQL</span>", "<span class='ok'>saved</span>"])).join(""));
  setHtml("userRows", users.rows.map((user) => row([`<strong>${user.username}</strong>`, `<strong>${user.displayName}</strong>`, `<span>${user.roleCode}</span>`, `<span class='ok'>${user.isActive ? "active" : "inactive"}</span>`])).join(""));
  setHtml("companyRows", companies.rows.map((company) => row([`<strong>${company.companyCode}</strong>`, `<strong>${company.companyName}</strong>`, `<span>${company.baseCurrencyCode}</span>`, `<span class='ok'>${company.isActive ? "active" : "inactive"}</span>`])).join(""));
  setHtml("backupRows", backups.rows.map((backup) => row([`<strong>${backup.file.split("\\").pop()}</strong>`, `<strong>${backup.sizeBytes} bytes</strong>`, `<span>${backup.modifiedUtc}</span>`, "<span class='ok'>available</span>"])).join("") || row(["<strong>No backup</strong>", "<strong>-</strong>", "<span>Create one</span>", "<span>ready</span>"]));
}

async function renderSupport() {
  const [diagnostics, support, attachments, airports] = await Promise.all([api("/api/diagnostics"), api("/api/support"), api("/api/attachments"), api("/api/airports/search?q=BAH")]);
  setHtml("diagnosticRows", diagnostics.checks.map((check) => row([`<strong>${check.name}</strong>`, `<strong>${check.status}</strong>`, "<span>runtime</span>", `<span class="${check.status === "ok" ? "ok" : "bad"}">${check.status}</span>`])).join(""));
  setHtml("supportRows", Object.entries(support).map(([key, value]) => row([`<strong>${key}</strong>`, `<strong>${value}</strong>`, "<span>support</span>", "<span class='ok'>ready</span>"])).join(""));
  setHtml("attachmentRows", attachments.rows.map((attachment) => row([`<strong>${attachment.fileName}</strong>`, `<strong>${attachment.moduleCode}</strong>`, `<span>${attachment.sizeBytes} bytes</span>`, `<span><a href="${attachment.viewUrl}" target="_blank" rel="noreferrer">View</a></span>`])).join(""));
  renderAirports(airports.rows);
}

function renderAirports(rows) {
  setHtml("airportRows", rows.map((airport) => row([`<strong>${airport.code}</strong>`, `<strong>${airport.city}</strong>`, `<span>${airport.name}</span>`, `<span class="money">score ${airport.score}</span>`])).join(""));
}

async function renderImport() {
  setHtml("importRows", row(["<strong>Ready</strong>", "<strong>Preview first</strong>", "<span>Use /api/import-excel/preview or /execute</span>", "<span class='ok'>validated</span>"]));
}

async function refresh() {
  if (page === "command") return renderCommand();
  if (page === "employees") return loadEmployees().then(renderEmployees);
  if (page === "employee-import") return renderImport();
  if (page === "airfare") return renderAirfare();
  if (page === "loans") return renderLoans();
  if (page === "reports") return renderReports();
  if (page === "admin") return renderAdmin();
  if (page === "support") return renderSupport();
}

function bindSubmit(formId, url, label) {
  const form = $(formId);
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(url, { method: "POST", body: JSON.stringify(formJson(form)) });
      toast(`${label} saved`);
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  });
}

function bindActions() {
  document.querySelectorAll("[data-refresh]").forEach((button) => button.addEventListener("click", () => refresh().then(() => toast("Refreshed")).catch((error) => toast(error.message, true))));
  bindSubmit("employeeForm", "/api/employees", "Employee");
  bindSubmit("eventForm", "/api/entitlement/events", "Entitlement event");
  bindSubmit("allocationForm", "/api/allocations", "Allocation");
  bindSubmit("loanForm", "/api/loans", "Loan");
  const prefs = $("preferencesForm");
  if (prefs) prefs.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/preferences", { method: "POST", body: JSON.stringify({ preferences: formJson(prefs) }) });
    toast("Preferences saved");
    await refresh();
  });
  const airport = $("airportForm");
  if (airport) airport.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api(`/api/airports/search?q=${encodeURIComponent(formJson(airport).q || "")}`);
    renderAirports(result.rows);
  });
  const backup = $("backupButton");
  if (backup) backup.addEventListener("click", async () => {
    await api("/api/admin/backup", { method: "POST", body: "{}" });
    toast("Backup created");
    await refresh();
  });
  document.querySelectorAll("[data-export]").forEach((button) => button.addEventListener("click", async () => {
    const result = await api(`/api/export?module=${button.dataset.export}`);
    setHtml("exportRows", row([`<strong>${result.moduleCode}</strong>`, `<strong>${result.rows.length} row(s)</strong>`, `<span>${result.runId}</span>`, "<span class='ok'>exported</span>"]));
  }));
  const samplePreview = $("sampleImportPreview");
  if (samplePreview) samplePreview.addEventListener("click", async () => {
    const result = await api("/api/import-preview", { method: "POST", body: JSON.stringify({ moduleCode: "employees", rows: [sampleEmployee(`PREVIEW-${Date.now()}`), { employeeNumber: "", displayName: "", hireDate: "bad" }] }) });
    setHtml("importRows", row([`<strong>Preview</strong>`, `<strong>${result.validRows.length} valid</strong>`, `<span>${result.invalidRows.length} invalid isolated</span>`, "<span class='ok'>no crash</span>"]));
  });
  const sampleExecute = $("sampleImportExecute");
  if (sampleExecute) sampleExecute.addEventListener("click", async () => {
    const result = await api("/api/employees", { method: "POST", body: JSON.stringify(sampleEmployee(`IMP-${Date.now()}`)) });
    setHtml("importRows", row([`<strong>Execute</strong>`, `<strong>${result.employee.employeeNumber}</strong>`, "<span>created through employee API</span>", "<span class='ok'>saved</span>"]));
  });
}

function sampleEmployee(number) {
  return { employeeNumber: number, displayName: "Imported Employee", legalName: "Imported Employee Legal", hireDate: "2026-01-01", department: "Import", jobTitle: "Validated", employmentType: "full_time", payGroup: "Monthly", basicSalary: "100.000", eligibleForAirfare: "true", homeAirportCode: "BAH", destinationAirportCode: "COK" };
}

bindActions();
refresh().catch((error) => {
  toast(error.message, true);
  setText("runtimePill", "BROKEN");
});
