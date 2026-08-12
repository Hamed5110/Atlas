"use strict";

const $ = (id) => document.getElementById(id);
const state = {
  employees: [],
  health: null,
  importPreviewToken: null,
  importHasErrors: false,
  search: "",
  status: ""
};

const modules = [
  ["Command", "/", "⌘1", "Live overview"],
  ["Employees", "/employees", "⌘2", "Master records"],
  ["Master Import", "/employee-import", "⌘3", "Verify then commit"],
  ["Airfare Allocation", "/airfare", "⌘4", "Claims + policy"],
  ["Loans / EMI", "/loans", "⌘5", "Recovery schedules"],
  ["Seed Evidence", "/support", "⌘6", "Legacy evidence only"],
  ["Reports", "/reports", "⌘7", "Exports + audit"],
  ["Preferences / Admin", "/admin", "⌘8", "Settings guard"],
  ["Self-Service", "/support", "⌘9", "Employee requests"],
  ["Attachments", "/support", "⌘10", "Document metadata"],
  ["Backup / Audit", "/support", "⌘11", "Operational safety"]
];

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const headers = options.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  const response = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const text = await response.text();
  const data = text ? safeJson(text) : {};
  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : text;
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function money(value) {
  return `BHD ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
}

function formatDate(value) {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

function toast(message, tone = "ok") {
  const node = $("toast");
  if (!node) return;
  node.className = `fixed bottom-5 right-5 z-[60] max-w-md rounded-2xl px-5 py-4 text-sm font-bold shadow-2xl ${
    tone === "bad" ? "bg-rose-600 text-white" : tone === "warn" ? "bg-amber-500 text-slate-950" : "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
  }`;
  node.textContent = message;
  window.clearTimeout(node.dataset.timer);
  node.dataset.timer = window.setTimeout(() => node.classList.add("hidden"), 3800);
}

function card(label, value, note, tone = "white") {
  const palette = tone === "blue"
    ? "border-blue-200 bg-blue-600 text-white"
    : tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
      : "border-slate-200 bg-white text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100";
  return `
    <article class="rounded-[1.5rem] border ${palette} p-5 shadow-soft">
      <p class="text-xs font-black uppercase tracking-[0.16em] ${tone === "blue" ? "text-blue-100" : "text-slate-500"}">${html(label)}</p>
      <strong class="mt-3 block text-3xl font-black">${html(value)}</strong>
      <span class="mt-2 block text-sm ${tone === "blue" ? "text-blue-100" : "text-slate-500 dark:text-slate-300"}">${html(note)}</span>
    </article>`;
}

function rowMetric(label, value, note, status = "ok") {
  const badge = status === "ok"
    ? "bg-emerald-100 text-emerald-800"
    : status === "bad"
      ? "bg-rose-100 text-rose-800"
      : "bg-amber-100 text-amber-800";
  return `
    <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
      <div class="min-w-0">
        <p class="truncate text-xs font-black uppercase tracking-[0.14em] text-slate-500">${html(label)}</p>
        <p class="truncate text-lg font-black">${html(value)}</p>
        <p class="truncate text-sm text-slate-500 dark:text-slate-300">${html(note)}</p>
      </div>
      <span class="self-start rounded-full px-3 py-1 text-xs font-black ${badge}">${html(status)}</span>
    </div>`;
}

function renderNav() {
  const current = window.location.pathname;
  const navHtml = modules.map(([label, href, key, note]) => {
    const active = href === current || (current === "/" && href === "/");
    return `
      <a href="${href}" class="grid min-h-12 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl px-3 py-2 text-sm transition ${
        active ? "bg-blue-50 font-black text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900" : "font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
      }">
        <span class="grid h-8 w-8 place-items-center rounded-xl ${active ? "bg-blue-600 text-white" : "bg-slate-100 dark:bg-slate-900"}">${label.slice(0, 1)}</span>
        <span class="min-w-0"><span class="block truncate">${label}</span><span class="block truncate text-xs font-medium text-slate-500">${note}</span></span>
        <kbd class="rounded-lg border border-slate-200 px-2 py-1 text-[0.65rem] text-slate-500 dark:border-slate-700">${key}</kbd>
      </a>`;
  }).join("");
  if ($("moduleNav")) $("moduleNav").innerHTML = navHtml;
  if ($("mobileModuleNav")) $("mobileModuleNav").innerHTML = navHtml;
}

async function loadHealth() {
  const health = await api("/api/v1/health");
  state.health = health;
  const ok = health.status === "ok" && health.port === 3356 && health.oldRuntimeLinked === false && health.legacyBatchCloseLinked === false;
  const badgeClass = ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800";
  if ($("apiBadge")) {
    $("apiBadge").className = `rounded-full px-3 py-1 text-xs font-black ${badgeClass}`;
    $("apiBadge").textContent = ok ? "API Online - Port 3356" : "API Review Required";
  }
  if ($("sqlBadge")) {
    $("sqlBadge").textContent = `${health.database?.serverName || "SQL"} / ${health.database?.databaseName || "database"}`;
  }
  if ($("sidebarHealth")) {
    $("sidebarHealth").className = `rounded-full px-3 py-1 text-xs font-black ${badgeClass}`;
    $("sidebarHealth").textContent = ok ? "clean" : "review";
  }
  if ($("runtimeProof")) {
    $("runtimeProof").innerHTML = [
      rowMetric("Version", health.version, health.application, "ok"),
      rowMetric("Port", String(health.port), "locked service endpoint", health.port === 3356 ? "ok" : "bad"),
      rowMetric("Database", health.database?.databaseName || "—", health.database?.serverName || "—", "ok"),
      rowMetric("Old Runtime Linked", String(health.oldRuntimeLinked), "must remain false", health.oldRuntimeLinked ? "bad" : "ok"),
      rowMetric("Legacy Batch Close Linked", String(health.legacyBatchCloseLinked), "must remain false", health.legacyBatchCloseLinked ? "bad" : "ok")
    ].join("");
  }
  return health;
}

async function loadEmployees() {
  const params = new URLSearchParams({ page: "1", page_size: "50" });
  if (state.status) params.set("status", state.status);
  if (state.search) params.set("search", state.search);
  const data = await api(`/api/v1/employees?${params.toString()}`);
  state.employees = data.items || [];
  renderEmployeeSelect();
  renderEmployeeTable(data.total || state.employees.length);
  return state.employees;
}

function renderEmployeeSelect() {
  const select = $("entitlementEmployee");
  if (!select) return;
  select.innerHTML = state.employees.map((employee) =>
    `<option value="${employee.employee_id}">${html(employee.employee_code)} — ${html(employee.full_name)}</option>`
  ).join("");
}

function renderEmployeeTable(total) {
  const body = $("employeeTable");
  if (!body) return;
  if (!state.employees.length) {
    body.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-slate-500">No employees found. Import or create master records first.</td></tr>`;
    return;
  }
  body.innerHTML = state.employees.map((employee) => {
    const active = employee.status === "Active";
    return `
      <tr class="align-top hover:bg-slate-50 dark:hover:bg-slate-950/70">
        <td class="whitespace-nowrap px-4 py-4 font-black">${html(employee.employee_code)}</td>
        <td class="min-w-64 px-4 py-4">
          <p class="font-black">${html(employee.full_name)}</p>
          <p class="text-xs text-slate-500">${html(employee.work_email || employee.personal_email || "no email")}</p>
        </td>
        <td class="min-w-56 px-4 py-4">
          <p class="font-bold">${html(employee.designation)}</p>
          <p class="text-xs text-slate-500">Dept ${html(employee.department_id || "—")} · ${html(employee.employment_type)}</p>
        </td>
        <td class="whitespace-nowrap px-4 py-4">
          <p class="font-bold">${html(employee.payment_mode)}</p>
          <p class="text-xs text-slate-500">${money(employee.basic_salary)}</p>
        </td>
        <td class="whitespace-nowrap px-4 py-4"><span class="rounded-full px-3 py-1 text-xs font-black ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}">${html(employee.status)}</span></td>
        <td class="whitespace-nowrap px-4 py-4 text-right">
          <button class="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black dark:border-slate-800" data-employee-detail="${employee.employee_id}">View</button>
          <button class="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 dark:border-blue-900 dark:bg-blue-950/40" data-compute-employee="${employee.employee_id}">Compute</button>
        </td>
      </tr>`;
  }).join("");
  const active = state.employees.filter((employee) => employee.status === "Active").length;
  const expiringDocs = state.employees.filter((employee) => employee.passport_expiry || employee.civil_id_expiry || employee.visa_expiry).length;
  const probation = state.employees.filter((employee) => employee.employment_type === "Probation").length;
  if ($("metricsGrid")) {
    $("metricsGrid").innerHTML = [
      card("Total Employees", String(total), "MSSQL master records"),
      card("Active Employees", String(active), "eligible workforce", "green"),
      card("On Probation", String(probation), "probation contracts"),
      card("Expiring Documents", String(expiringDocs), "passport / ID / visa tracked", "blue")
    ].join("");
  }
}

async function computeEntitlement(employeeId = null) {
  const empId = employeeId || $("entitlementEmployee")?.value;
  const targetDate = $("targetDate")?.value || new Date().toISOString().slice(0, 10);
  if (!empId) {
    toast("No employee selected for entitlement calculation.", "warn");
    return;
  }
  const result = await api(`/api/v1/airfare/entitlement/${encodeURIComponent(empId)}?target_date=${encodeURIComponent(targetDate)}`);
  if ($("entitlementResult")) {
    $("entitlementResult").innerHTML = [
      rowMetric("Employee", `${result.employeeCode} · ${result.fullName}`, `Joined ${formatDate(result.joiningDate)}`, "ok"),
      rowMetric("Elapsed Service", `${result.elapsedServiceDays} days`, `Target ${formatDate(result.targetDate)}`, "ok"),
      rowMetric("Accrued", money(result.accruedBalance), `Monthly rate ${money(result.monthlyRate)}`, "ok"),
      rowMetric("Available", money(result.availableBalance), `Seed ${money(result.seedBalance)} · Claims ${money(result.claimedBalance)}`, Number(result.availableBalance) >= 0 ? "ok" : "bad")
    ].join("");
  }
}

function openImportModal() {
  $("importModal")?.classList.remove("hidden");
  $("importModal")?.classList.add("flex");
}

function closeImportModal() {
  $("importModal")?.classList.add("hidden");
  $("importModal")?.classList.remove("flex");
}

function setProgress(percent) {
  if ($("importProgress")) $("importProgress").style.width = `${percent}%`;
}

async function verifyImportFile() {
  const file = $("importFile")?.files?.[0];
  if (!file) {
    toast("Select a CSV/XLSX file first.", "warn");
    return;
  }
  const form = new FormData();
  form.append("file", file);
  setProgress(25);
  const result = await api("/api/v1/import/verify-preview", { method: "POST", body: form });
  setProgress(70);
  state.importPreviewToken = result.previewToken;
  state.importHasErrors = Number(result.errorRowsCount) > 0;
  renderImportPreview(result);
  updateCommitButton();
  setProgress(100);
  toast("Import verification complete. No database write performed.");
}

function renderImportPreview(result) {
  if ($("importSummary")) {
    $("importSummary").innerHTML = [
      rowMetric("Total Rows", result.totalRows, "parsed from uploaded file", "ok"),
      rowMetric("Valid Rows", result.validRowsCount, "eligible for commit", "ok"),
      rowMetric("Error Rows", result.errorRowsCount, "must be reviewed", result.errorRowsCount ? "bad" : "ok"),
      rowMetric("Duplicates", result.duplicateRowsCount, "existing or repeated IDs", result.duplicateRowsCount ? "bad" : "ok")
    ].join("");
  }
  if ($("importPreviewRows")) {
    $("importPreviewRows").innerHTML = (result.previewData || []).map((record) => {
      const errors = record.fields.filter((field) => field.status === "ERROR");
      const warnings = record.fields.filter((field) => field.status === "WARNING");
      const statusClass = record.status === "VALID" ? "bg-emerald-100 text-emerald-800" : record.status === "WARNING" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800";
      const fieldHtml = record.fields.slice(0, 8).map((field) => {
        const cls = field.status === "ERROR" ? "border-rose-300 bg-rose-50 text-rose-800" : field.status === "WARNING" ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950";
        return `<span title="${html(field.reason || "Valid")}" class="inline-flex max-w-[14rem] items-center gap-1 truncate rounded-lg border px-2 py-1 ${cls}"><b>${html(field.column)}</b>: ${html(field.value || "—")}</span>`;
      }).join(" ");
      return `
        <tr class="align-top">
          <td class="px-3 py-3 font-black">${record.row}</td>
          <td class="px-3 py-3"><span class="rounded-full px-2 py-1 text-xs font-black ${statusClass}">${html(record.status)}</span></td>
          <td class="px-3 py-3"><div class="flex flex-wrap gap-1">${fieldHtml}</div></td>
          <td class="px-3 py-3 text-rose-700">${html([...errors, ...warnings].map((field) => `${field.column}: ${field.reason}`).join("; ") || "—")}</td>
        </tr>`;
    }).join("");
  }
}

function updateCommitButton() {
  const button = $("commitImport");
  if (!button) return;
  const acknowledged = $("ackImportErrors")?.checked || !state.importHasErrors;
  button.disabled = !state.importPreviewToken || !acknowledged;
  button.className = `w-full rounded-2xl px-4 py-3 text-sm font-black ${
    button.disabled ? "cursor-not-allowed bg-slate-300 text-slate-600 dark:bg-slate-800 dark:text-slate-400" : "bg-emerald-600 text-white"
  }`;
}

async function commitImport() {
  if (!state.importPreviewToken) {
    toast("Run verification first.", "warn");
    return;
  }
  setProgress(35);
  const result = await api("/api/v1/import/commit", {
    method: "POST",
    body: JSON.stringify({ previewToken: state.importPreviewToken })
  });
  setProgress(100);
  toast(`Import committed: ${result.insertedRows} inserted, ${result.skippedRows} skipped.`);
  state.importPreviewToken = null;
  await loadEmployees();
}

function bindEvents() {
  renderNav();
  $("openSidebar")?.addEventListener("click", () => $("mobileSidebar")?.classList.remove("hidden"));
  $("closeSidebar")?.addEventListener("click", () => $("mobileSidebar")?.classList.add("hidden"));
  $("themeToggle")?.addEventListener("click", () => document.documentElement.classList.toggle("dark"));
  document.querySelectorAll("[data-refresh]").forEach((button) => button.addEventListener("click", () => refreshAll().then(() => toast("Live data refreshed")).catch((error) => toast(error.message, "bad"))));
  $("globalSearch")?.addEventListener("input", debounce((event) => {
    state.search = event.target.value.trim();
    loadEmployees().catch((error) => toast(error.message, "bad"));
  }, 350));
  $("statusFilter")?.addEventListener("change", (event) => {
    state.status = event.target.value;
    loadEmployees().catch((error) => toast(error.message, "bad"));
  });
  $("computeEntitlement")?.addEventListener("click", () => computeEntitlement().catch((error) => toast(error.message, "bad")));
  $("openImportModal")?.addEventListener("click", openImportModal);
  $("closeImportModal")?.addEventListener("click", closeImportModal);
  $("verifyImport")?.addEventListener("click", () => verifyImportFile().catch((error) => {
    setProgress(0);
    toast(error.message, "bad");
  }));
  $("ackImportErrors")?.addEventListener("change", updateCommitButton);
  $("commitImport")?.addEventListener("click", () => commitImport().catch((error) => {
    setProgress(0);
    toast(error.message, "bad");
  }));
  document.addEventListener("click", (event) => {
    const computeButton = event.target.closest("[data-compute-employee]");
    if (computeButton) {
      computeEntitlement(computeButton.dataset.computeEmployee).catch((error) => toast(error.message, "bad"));
    }
  });
  const today = new Date().toISOString().slice(0, 10);
  if ($("targetDate")) $("targetDate").value = today;
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

async function refreshAll() {
  await loadHealth();
  await loadEmployees();
  if (state.employees.length) {
    await computeEntitlement(state.employees[0].employee_id);
  } else if ($("entitlementResult")) {
    $("entitlementResult").innerHTML = rowMetric("No Employee", "Import master data", "entitlement needs an employee record", "warn");
  }
}

bindEvents();
refreshAll().catch((error) => {
  toast(error.message, "bad");
  if ($("apiBadge")) {
    $("apiBadge").className = "rounded-full bg-rose-100 px-3 py-1 text-xs font-black text-rose-800";
    $("apiBadge").textContent = "API Offline";
  }
});
