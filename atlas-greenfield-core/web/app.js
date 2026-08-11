const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const AS_OF_DATE = "2026-12-31";

const state = {
  employees: [],
  companies: [],
  summary: null,
  balances: [],
  seeds: [],
  allocations: [],
  loans: [],
  loanSummary: null
};

const $ = (selector) => document.querySelector(selector);
const els = {
  runtimeStatus: $("#runtimeStatus"),
  runtimeDetail: $("#runtimeDetail"),
  employeeCount: $("#employeeCount"),
  entitlementBalance: $("#entitlementBalance"),
  loanCount: $("#loanCount"),
  employeeRows: $("#employeeRows"),
  companyRows: $("#companyRows"),
  summaryRows: $("#summaryRows"),
  entitlementRows: $("#entitlementRows"),
  seedRows: $("#seedRows"),
  allocationRows: $("#allocationRows"),
  loanRows: $("#loanRows"),
  employeeForm: $("#employeeForm"),
  formMessage: $("#formMessage"),
  refreshButton: $("#refreshButton"),
  nav: $("#moduleNav")
};

els.nav.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-module]");
  if (!button) return;
  document.querySelectorAll("#moduleNav button").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll(".module").forEach((item) => item.classList.toggle("active", item.id === button.dataset.module));
});

els.refreshButton.addEventListener("click", refresh);
els.employeeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  payload.tenantId = TENANT_ID;
  payload.companyId = COMPANY_ID;
  try {
    const response = await api("/api/employees", { method: "POST", body: payload });
    els.formMessage.textContent = `Saved ${response.employee.displayName}.`;
    event.currentTarget.reset();
    await refresh();
  } catch (error) {
    els.formMessage.textContent = error.message;
  }
});

async function refresh() {
  const scope = `tenantId=${TENANT_ID}&companyId=${COMPANY_ID}`;
  const [health, companies, employees, summary, balances, seeds, allocations, loans, loanSummary] = await Promise.all([
    api("/api/health"),
    api(`/api/companies?tenantId=${TENANT_ID}`),
    api(`/api/employees?${scope}`),
    api(`/api/summary?${scope}&asOfDate=${AS_OF_DATE}`),
    api(`/api/entitlement/balance?${scope}&asOfDate=${AS_OF_DATE}`),
    api(`/api/opening-seeds?${scope}`),
    api(`/api/allocations?${scope}`),
    api(`/api/loans?${scope}`),
    api(`/api/loans/summary?${scope}`)
  ]);
  els.runtimeStatus.textContent = health.status === "ok" && health.oldRuntimeLinked === false ? "GREEN" : "RED";
  els.runtimeDetail.textContent = `${health.application} · v${health.version}`;
  state.companies = companies.rows || [];
  state.employees = employees.rows || [];
  state.summary = summary;
  state.balances = balances.rows || [];
  state.seeds = seeds.rows || [];
  state.allocations = allocations.rows || [];
  state.loans = loans.rows || [];
  state.loanSummary = loanSummary;
  render();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `${path} failed`);
  return body;
}

function render() {
  els.employeeCount.textContent = String(state.summary.employees.total);
  els.entitlementBalance.textContent = money(state.summary.entitlement.totalBalance);
  els.loanCount.textContent = String(state.summary.loans.activeLoans);

  renderKeyValues(els.summaryRows, {
    "as-of date": state.summary.asOfDate,
    "active employees": state.summary.employees.active,
    "entitlement used": money(state.summary.entitlement.totalUsed),
    "allocations": state.summary.allocations.total,
    "seed records": state.summary.openingSeeds.total,
    "monthly EMI": money(state.summary.loans.monthlyEmi)
  });

  renderRows(els.companyRows, state.companies, (company) => [company.companyCode, company.companyName, company.baseCurrencyCode]);
  renderRows(els.employeeRows, state.employees, (employee) => [employee.employeeNumber, employee.displayName, employee.department || "Unassigned", employee.statusCode]);
  renderRows(els.entitlementRows, state.balances, (row) => [row.employeeNumber, row.displayName, money(row.earnedAmount), money(row.usedAmount), money(row.balanceAmount)]);
  renderRows(els.seedRows, state.seeds, (row) => [row.seedDate, employeeName(row.employeeId), `${row.days} days`, money(row.amount)]);
  renderRows(els.allocationRows, state.allocations, (row) => [row.allocationDate, employeeName(row.employeeId), money(row.ticketCost), money(row.entitlementApplied), money(row.companyPaid)]);
  renderRows(els.loanRows, state.loans, (row) => [employeeName(row.employeeId), money(row.principalAmount), money(row.emiAmount), row.statusCode]);
}

function renderKeyValues(target, values) {
  target.innerHTML = Object.entries(values).map(([key, value]) => `<div class="row"><strong>${escapeHtml(key)}</strong><span>${escapeHtml(value)}</span></div>`).join("");
}

function renderRows(target, rows, mapper) {
  if (!rows.length) {
    target.innerHTML = `<div class="row"><strong>No records</strong><span>Ready for clean data.</span></div>`;
    return;
  }
  target.innerHTML = rows.map((row) => `<div class="row">${mapper(row).map((cell) => `<span>${escapeHtml(cell)}</span>`).join("")}</div>`).join("");
}

function employeeName(employeeId) {
  const employee = state.employees.find((row) => row.employeeId === employeeId);
  return employee ? employee.displayName : employeeId;
}

function money(value) {
  return new Intl.NumberFormat("en-BH", { style: "currency", currency: "BHD" }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

refresh();
