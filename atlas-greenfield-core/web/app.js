const TENANT_ID = "tenant-atlas-demo";
const COMPANY_ID = "company-atlas-airfare";

const state = {
  employees: []
};

const els = {
  runtimeStatus: document.querySelector("#runtimeStatus"),
  employeeCount: document.querySelector("#employeeCount"),
  employeeRows: document.querySelector("#employeeRows"),
  employeeForm: document.querySelector("#employeeForm"),
  formMessage: document.querySelector("#formMessage"),
  refreshButton: document.querySelector("#refreshButton")
};

els.refreshButton.addEventListener("click", refresh);
els.employeeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  payload.tenantId = TENANT_ID;
  payload.companyId = COMPANY_ID;
  try {
    const response = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Employee save failed.");
    els.formMessage.textContent = `Saved ${body.employee.displayName}.`;
    event.currentTarget.reset();
    await refresh();
  } catch (error) {
    els.formMessage.textContent = error.message;
  }
});

async function refresh() {
  const [health, employees] = await Promise.all([
    fetch("/api/health").then((r) => r.json()),
    fetch(`/api/employees?tenantId=${TENANT_ID}&companyId=${COMPANY_ID}`).then((r) => r.json())
  ]);
  els.runtimeStatus.textContent = health.status === "ok" ? "green" : "red";
  state.employees = employees.rows || [];
  els.employeeCount.textContent = String(state.employees.length);
  renderEmployees();
}

function renderEmployees() {
  els.employeeRows.innerHTML = "";
  if (!state.employees.length) {
    els.employeeRows.innerHTML = `<div class="row"><strong>No employees yet</strong><span>Create the first master record.</span><span></span><span></span></div>`;
    return;
  }
  for (const employee of state.employees) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <strong>${escapeHtml(employee.employeeNumber)}</strong>
      <span>${escapeHtml(employee.displayName)}</span>
      <span>${escapeHtml(employee.department || "Unassigned")}</span>
      <span>${escapeHtml(employee.statusCode)}</span>
    `;
    els.employeeRows.append(row);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

refresh();
