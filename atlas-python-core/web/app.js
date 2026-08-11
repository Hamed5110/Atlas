const $ = (id) => document.getElementById(id);
const asOfDate = "2026-12-31";
let employees = [];

async function api(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return JSON.parse(text);
}

function formJson(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function money(value) {
  return `BHD ${Number(value || 0).toFixed(3)}`;
}

function toast(message, bad = false) {
  const box = $("toast");
  box.textContent = message;
  box.style.background = bad ? "#991b1b" : "#0f172a";
  box.classList.add("show");
  setTimeout(() => box.classList.remove("show"), 3200);
}

function row(cells) {
  return `<div class="row">${cells.map((cell) => cell).join("")}</div>`;
}

function employeeOptions() {
  const options = employees.map((employee) => `<option value="${employee.employeeId}">${employee.employeeNumber} — ${employee.displayName}</option>`).join("");
  $("eventEmployee").innerHTML = options;
  $("allocationEmployee").innerHTML = options;
  $("loanEmployee").innerHTML = options;
  $("selfServiceEmployee").innerHTML = options;
}

async function refresh() {
  const [health, summary, companyData, employeeData, rules, events, balances, allocations, loans, reconciliation, selfService, payable, employeeReport, preferences, users, diagnostics, support, attachments, backups, airports] = await Promise.all([
    api("/api/health"),
    api(`/api/summary?asOfDate=${asOfDate}`),
    api("/api/companies"),
    api("/api/employees"),
    api("/api/entitlement/rules"),
    api("/api/entitlement/events"),
    api(`/api/entitlement/balance?asOfDate=${asOfDate}`),
    api("/api/allocations"),
    api("/api/loans"),
    api(`/api/entitlement/reconciliation?asOfDate=${asOfDate}`),
    api("/api/self-service/requests"),
    api(`/api/reports/airfare-payable?asOfDate=${asOfDate}`),
    api("/api/reports/employees"),
    api("/api/preferences"),
    api("/api/users"),
    api("/api/diagnostics"),
    api("/api/support"),
    api("/api/attachments"),
    api("/api/admin/backups"),
    api("/api/airports/search?q=BAH")
  ]);

  employees = employeeData.rows;
  employeeOptions();

  $("runtime").textContent = summary.runtime;
  $("version").textContent = `${health.application} - v${health.version}`;
  $("database").textContent = health.database.databaseName;
  $("schema").textContent = `${companyData.rows[0]?.companyName || "No company"} / core ${health.database.objects.employees ? "ready" : "missing"}`;
  $("employees").textContent = summary.employees.active;
  $("balance").textContent = money(summary.entitlement.balance);
  $("allocationsTotal").textContent = summary.allocations.total;
  $("allocationsValue").textContent = `${money(summary.allocations.entitlementApplied)} entitlement used`;
  $("loans").textContent = summary.loans.active;
  $("emi").textContent = `${money(summary.loans.monthlyEmi)} monthly`;

  $("employeeRows").innerHTML = employees.map((employee) => row([
    `<strong>${employee.employeeNumber}</strong>`,
    `<strong>${employee.displayName}</strong>`,
    `<span>${employee.department || "-"}</span>`,
    `<span class="ok">${employee.statusCode}</span>`
  ])).join("");

  $("ruleRows").innerHTML = rules.rows.map((rule) => row([
    `<strong>${rule.ruleCode}</strong>`,
    `<strong>${rule.ruleName}</strong>`,
    `<span>${rule.cadence}</span>`,
    `<span class="money">${money(rule.maxPayoutAmount)}</span>`
  ])).join("");

  $("balanceRows").innerHTML = balances.rows.map((balance) => row([
    `<strong>${balance.employeeNumber}</strong>`,
    `<strong>${balance.displayName}</strong>`,
    `<span>Earned ${money(balance.earned)} / Used ${money(balance.used)}</span>`,
    `<span class="money">Balance ${money(balance.balance)}</span>`
  ])).join("");

  $("eventRows").innerHTML = events.rows.map((event) => row([
    `<strong>${event.eventDate}</strong>`,
    `<strong>${event.employeeNumber} ${event.displayName}</strong>`,
    `<span>${event.eventType}</span>`,
    `<span class="money">${money(event.amount)}</span>`
  ])).join("");

  $("allocationRows").innerHTML = allocations.rows.map((allocation) => row([
    `<strong>${allocation.allocationDate}</strong>`,
    `<strong>${allocation.employeeNumber} ${allocation.displayName}</strong>`,
    `<span>Ticket ${money(allocation.ticketCost)} / Applied ${money(allocation.entitlementApplied)}</span>`,
    `<span class="money">Company ${money(allocation.companyPaid)}</span>`
  ])).join("");

  $("loanRows").innerHTML = loans.rows.map((loan) => row([
    `<strong>${loan.startDate}</strong>`,
    `<strong>${loan.employeeNumber} ${loan.displayName}</strong>`,
    `<span>Principal ${money(loan.principalAmount)}</span>`,
    `<span class="money">EMI ${money(loan.emiAmount)}</span>`
  ])).join("");

  $("reconciliationStatus").textContent = reconciliation.status;
  $("reconciliationNote").textContent = reconciliation.note;
  $("reconciliationRows").innerHTML = reconciliation.rows.map((item) => row([
    `<strong>${item.employeeNumber}</strong>`,
    `<strong>${item.displayName}</strong>`,
    `<span>Earned ${money(item.earned)} / Used ${money(item.used)}</span>`,
    `<span class="${item.balance < 0 ? "bad" : "ok"}">${money(item.balance)}</span>`
  ])).join("");

  $("selfServiceRows").innerHTML = selfService.rows.map((request) => row([
    `<strong>${request.requestDate}</strong>`,
    `<strong>${request.employeeNumber} ${request.displayName}</strong>`,
    `<span>${request.requestType}</span>`,
    `<span class="money">${request.statusCode} / ${money(request.amount)}</span>`
  ])).join("");

  $("payableReportRows").innerHTML = row([
    `<strong>${payable.asOfDate}</strong>`,
    `<strong>${payable.employeeCount} employee(s)</strong>`,
    `<span>Total payable</span>`,
    `<span class="money">${money(payable.totalPayable)}</span>`
  ]);

  $("employeeReportRows").innerHTML = Object.entries(employeeReport.departments).map(([department, count]) => row([
    `<strong>${department}</strong>`,
    `<strong>${count}</strong>`,
    `<span>employee(s)</span>`,
    `<span class="ok">active scope</span>`
  ])).join("");

  $("preferenceRows").innerHTML = Object.entries(preferences.preferences).map(([key, value]) => row([
    `<strong>${key}</strong>`,
    `<strong>${value}</strong>`,
    `<span>MSSQL</span>`,
    `<span class="ok">saved</span>`
  ])).join("");

  $("userRows").innerHTML = users.rows.map((user) => row([
    `<strong>${user.username}</strong>`,
    `<strong>${user.displayName}</strong>`,
    `<span>${user.roleCode}</span>`,
    `<span class="ok">${user.isActive ? "active" : "inactive"}</span>`
  ])).join("");

  $("companyRows").innerHTML = companyData.rows.map((company) => row([
    `<strong>${company.companyCode}</strong>`,
    `<strong>${company.companyName}</strong>`,
    `<span>${company.baseCurrencyCode}</span>`,
    `<span class="ok">${company.isActive ? "active" : "inactive"}</span>`
  ])).join("");

  $("diagnosticRows").innerHTML = diagnostics.checks.map((check) => row([
    `<strong>${check.name}</strong>`,
    `<strong>${check.status}</strong>`,
    `<span>runtime</span>`,
    `<span class="${check.status === "ok" ? "ok" : "bad"}">${check.status}</span>`
  ])).join("");

  $("supportRows").innerHTML = [
    ["Product", support.product],
    ["URL", support.localUrl],
    ["Database", support.database],
    ["Mode", support.supportMode]
  ].map(([key, value]) => row([`<strong>${key}</strong>`, `<strong>${value}</strong>`, `<span>support</span>`, `<span class="ok">ready</span>`])).join("");

  $("attachmentRows").innerHTML = attachments.rows.map((attachment) => row([
    `<strong>${attachment.fileName}</strong>`,
    `<strong>${attachment.moduleCode}</strong>`,
    `<span>${attachment.sizeBytes} bytes</span>`,
    `<span><a href="${attachment.viewUrl}" target="_blank" rel="noreferrer">View</a></span>`
  ])).join("");

  $("backupRows").innerHTML = backups.rows.length ? backups.rows.map((backup) => row([
    `<strong>${backup.file.split("\\").pop()}</strong>`,
    `<strong>${backup.sizeBytes} bytes</strong>`,
    `<span>${backup.modifiedUtc}</span>`,
    `<span class="ok">available</span>`
  ])).join("") : row([`<strong>No backups yet</strong>`, `<strong>-</strong>`, `<span>Create one</span>`, `<span>ready</span>`]);

  renderAirports(airports.rows);
  $("excelRows").innerHTML = row([`<strong>Employees Excel</strong>`, `<strong>/api/import-excel/execute</strong>`, `<span>base64 .xlsx</span>`, `<span class="ok">ready</span>`]);
}

function renderAirports(rows) {
  $("airportRows").innerHTML = rows.map((airport) => row([
    `<strong>${airport.code}</strong>`,
    `<strong>${airport.city}</strong>`,
    `<span>${airport.name}</span>`,
    `<span class="money">score ${airport.score}</span>`
  ])).join("");
}

async function submit(formId, url, label) {
  const form = $(formId);
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

document.querySelectorAll("nav a").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll("nav a").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});

$("refresh").addEventListener("click", () => refresh().then(() => toast("Refreshed")).catch((error) => toast(error.message, true)));
submit("employeeForm", "/api/employees", "Employee");
submit("eventForm", "/api/entitlement/events", "Entitlement event");
submit("allocationForm", "/api/allocations", "Allocation");
submit("loanForm", "/api/loans", "Loan");
submit("selfServiceForm", "/api/self-service/requests", "Self-service request");
$("preferencesForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/preferences", { method: "POST", body: JSON.stringify({ preferences: formJson($("preferencesForm")) }) });
    toast("Preferences saved");
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
});
$("airportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const q = encodeURIComponent(formJson($("airportForm")).q || "");
    const result = await api(`/api/airports/search?q=${q}`);
    renderAirports(result.rows);
    toast("Airports ranked");
  } catch (error) {
    toast(error.message, true);
  }
});
$("backupButton").addEventListener("click", async () => {
  try {
    await api("/api/admin/backup", { method: "POST", body: "{}" });
    toast("Backup created");
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
});
refresh().catch((error) => {
  $("runtime").textContent = "BROKEN";
  $("version").textContent = error.message;
  toast(error.message, true);
});
