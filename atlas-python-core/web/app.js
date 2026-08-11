const qs = (id) => document.getElementById(id);
const asOfDate = "2026-12-31";

async function json(url) {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return JSON.parse(text);
}

async function refresh() {
  const [health, summary, employees, balances] = await Promise.all([
    json("/api/health"),
    json(`/api/summary?asOfDate=${asOfDate}`),
    json("/api/employees"),
    json(`/api/entitlement/balance?asOfDate=${asOfDate}`)
  ]);
  qs("runtime").textContent = summary.runtime;
  qs("version").textContent = `${health.application} · v${health.version}`;
  qs("database").textContent = health.database.databaseName;
  qs("schema").textContent = health.database.objects.employees ? "core ready" : "core missing";
  qs("employees").textContent = summary.employees.active;
  qs("balance").textContent = `BHD ${summary.entitlement.balance.toFixed(3)}`;
  qs("employeeRows").innerHTML = employees.rows.map(row => `<div class="row"><strong>${row.employeeNumber}</strong><strong>${row.displayName}</strong><span>${row.department || "-"}</span><span>${row.statusCode}</span></div>`).join("");
  qs("balanceRows").innerHTML = balances.rows.map(row => `<div class="row"><strong>${row.employeeNumber}</strong><strong>${row.displayName}</strong><span>Earned BHD ${row.earned.toFixed(3)}</span><span>Balance BHD ${row.balance.toFixed(3)}</span></div>`).join("");
}

qs("refresh").addEventListener("click", refresh);
refresh().catch(error => {
  qs("runtime").textContent = "BROKEN";
  qs("version").textContent = error.message;
});
